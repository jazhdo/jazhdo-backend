#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/select.h>
#include <signal.h>

#define PORT 8080
#define BOUNDARY "jpgboundary"
#define BUFSIZE (1024 * 1024)

FILE *open_stream(void) {
    FILE *pipe = popen(
        "rpicam-vid -t 0"
        " --width 1536 --height 864"
        " --framerate 30"
        " --codec mjpeg"
        " --nopreview"
        " -o -",
        "r"
    );
    if (!pipe) { fprintf(stderr, "failed to open rpicam-vid\n"); exit(1); }
    return pipe;
}

int start_server(void) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) { perror("socket"); exit(1); }
    int opt = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    struct sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(PORT);
    if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) { perror("bind"); exit(1); }
    if (listen(fd, 5) < 0) { perror("listen"); exit(1); }
    printf("http://0.0.0.0:%d\n", PORT);
    return fd;
}

int main(void) {
    signal(SIGPIPE, SIG_IGN);
    FILE *cam = open_stream();
    int server_fd = start_server();

    while (1) {
        int client_fd = accept(server_fd, NULL, NULL);
        if (client_fd < 0) { perror("accept"); continue; }

        int flag = 1;
        setsockopt(client_fd, IPPROTO_TCP, TCP_NODELAY, &flag, sizeof(flag));

        char req[1024] = {0};
        read(client_fd, req, sizeof(req) - 1);

        if (strstr(req, "GET / ")) {
            dprintf(client_fd,
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: text/html\r\n\r\n"
                "<html><body style='margin:0'>"
                "<img src='/stream' style='width:100%%'>"
                "</body></html>\r\n");
            close(client_fd);
            continue;
        }

        /* stream endpoint */
        dprintf(client_fd,
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: multipart/x-mixed-replace; boundary=%s\r\n"
            "Cache-Control: no-cache\r\n\r\n", BOUNDARY);

        static unsigned char frame[BUFSIZE];
        int len = 0;
        int c, prev = 0;

        while ((c = fgetc(cam)) != EOF) {
            if (len < BUFSIZE) frame[len++] = c;
            if (prev == 0xFF && c == 0xD9) {
                dprintf(client_fd,
                    "--%s\r\n"
                    "Content-Type: image/jpeg\r\n"
                    "Content-Length: %d\r\n\r\n",
                    BOUNDARY, len);
                if (write(client_fd, frame, len) < 0) break;
                dprintf(client_fd, "\r\n");
                len = 0;
            }
            prev = c;
        }

        close(client_fd);

        /* drain pipe while waiting for next client */
        fd_set fds;
        struct timeval tv;
        while (1) {
            FD_ZERO(&fds);
            FD_SET(server_fd, &fds);
            tv.tv_sec = 0;
            tv.tv_usec = 0;
            /* if a new client is waiting, stop draining */
            if (select(server_fd + 1, &fds, NULL, NULL, &tv) > 0) break;
            /* otherwise drain a chunk from cam */
            unsigned char drain[4096];
            fread(drain, 1, sizeof(drain), cam);
        }
    }

    pclose(cam);
    close(server_fd);
    return 0;
}