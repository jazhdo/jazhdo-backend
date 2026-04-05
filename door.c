#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>

#define PORT 8080
#define WIDTH 2304
#define HEIGHT 1296
#define FPS 30
#define BOUNDARY "frame"

FILE *open_stream(void) {
    FILE *pipe = popen("rpicam-vid -t 0 --width 2304 --height 1296 --framerate 30 --codec mjpeg --nopreview -o -", "r");
    if (!pipe) {
        fprintf(stderr, "failed to open rpicam-vid\n");
        exit(1);
    }
    return pipe;
}

int start_server(void) {
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) {
        perror("socket");
        exit(1);
    }

    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(PORT);

    if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind");
        exit(1);
    }
    if (listen(server_fd, 1) < 0) {
        perror("listen");
        exit(1);
    }

    printf("server listening on http://0.0.0.0:%d\n", PORT);
    return server_fd;
}

int main(void) {
    FILE *cam = open_stream();
    int server_fd = start_server();

    /* read jpeg frames from rpicam-vid and serve over http */
    while (1) {
        /* wait for a browser to connect */
        int client_fd = accept(server_fd, NULL, NULL);
        if (client_fd < 0) {
            perror("accept");
            continue;
        }

        /* send HTTP headers for MJPEG stream */
        dprintf(client_fd, "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=%s\r\n\r\n", BOUNDARY);

        /* stream frames */
        unsigned char buf[65536];
        size_t n;
        while ((n = fread(buf, 1, sizeof(buf), cam)) > 0) {
            dprintf(client_fd, "--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %zu\r\n\r\n", BOUNDARY, n);
            write(client_fd, buf, n);
            dprintf(client_fd, "\r\n");
        }

        close(client_fd);
    }

    pclose(cam);
    close(server_fd);
    return 0;
}