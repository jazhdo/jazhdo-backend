# define _POSIX_C_SOURCE 200809L
# include <stdio.h>
# include <stdlib.h>
# include <string.h>
# include <unistd.h>
# include <signal.h>
# include <pthread.h>
# include <sys/socket.h>
# include <sys/select.h>
# include <netinet/in.h>
# include <netinet/tcp.h>
# include <time.h>
# include <linux/i2c-dev.h>
# include <sys/ioctl.h>
# include <fcntl.h>
# include <ctype.h>
# include "dotenv.h"
# include <gpiod.h>

# define PORT 8080
# define BOUNDARY "jpgboundary"
# define BUFSIZE (1024 * 1024)

FILE *cam = NULL;
volatile FILE *recording = NULL;
int server_fd;
/* Lock to prevent races */
pthread_mutex_t rec_lock = PTHREAD_MUTEX_INITIALIZER;

/* Start camera */
FILE *open_stream(void) {
    FILE *pipe = popen(
        "rpicam-vid -t 0"
        " --width 1536 --height 864"
        " --framerate 60"
        " --codec mjpeg"
        " --nopreview"
        " -o -",
        "r"
    );
    if (!pipe) { fprintf(stderr, "failed to open rpicam-vid\n"); exit(1); }
    return pipe;
}

/* handle client connection */
void *handle_client(void *arg) {
    int client_fd = *(int *)arg;
    free(arg);

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
        return NULL;
    }

    if (strstr(req, "GET /record/start")) {
        if (!recording) recording = fopen("recording.mjpeg", "wb");
        dprintf(client_fd, "HTTP/1.1 200 OK\r\n\r\nRecording started\r\n");
        close(client_fd);
        return NULL;
    }

    if (strstr(req, "GET /record/stop")) {
        pthread_mutex_lock(&rec_lock);
        if (recording) { fclose((FILE *)recording); recording = NULL; }
        pthread_mutex_unlock(&rec_lock);
        char filename[64];
        time_t t = time(NULL);
        struct tm *tm = localtime(&t);
        strftime(filename, sizeof(filename), "recording_%Y%m%d_%H%M%S.mp4", tm);

        char cmd[256];
        snprintf(cmd, sizeof(cmd), "ffmpeg -y -framerate 60 -f mjpeg -i recording.mjpeg -c:v copy %s &", filename);
        system(cmd);
        dprintf(client_fd, "HTTP/1.1 200 OK\r\n\r\nRecording stopped\r\n");
        close(client_fd);
        return NULL;
    }

    /* stream endpoint */
    dprintf(client_fd,
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: multipart/x-mixed-replace; boundary=%s\r\n"
        "Cache-Control: no-cache\r\n\r\n", BOUNDARY);

    unsigned char *frame = malloc(BUFSIZE);
    if (!frame) {
        close(client_fd);
        return NULL;
    }
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
            pthread_mutex_lock(&rec_lock);
            if (recording) {
                FILE *r = (FILE *)recording;
                if (r) {
                    printf("writing frame %d bytes\n", len);
                    fwrite(frame, 1, len, (FILE *)recording);
                    fflush((FILE *)recording);
                }
            }
            pthread_mutex_unlock(&rec_lock);
            len = 0;
        }
        prev = c;
    }

    /* drain pipe while waiting for next client */
    fd_set fds;
    struct timeval tv;
    unsigned char drain[4096];
    while (1) {
        FD_ZERO(&fds);
        FD_SET(server_fd, &fds);
        tv.tv_sec = 0;
        tv.tv_usec = 0;
        if (select(server_fd + 1, &fds, NULL, NULL, &tv) > 0) break;
        if (!recording) fread(drain, 1, sizeof(drain), cam);
    }

    free(frame);
    close(client_fd);
    return NULL;
}

/* start http camera viewing server */
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

/* delay_microseconds: delay us microseconds */
void delay_microseconds(int us) {
    struct timespec start, now;
    clock_gettime(CLOCK_MONOTONIC, &start);
    while (1) {
        clock_gettime(CLOCK_MONOTONIC, &now);
        long elapsed = (now.tv_sec - start.tv_sec) * 1000000 + (now.tv_nsec - start.tv_nsec) / 1000;
        if (elapsed >= us) break;
    }
}

/* send a byte data to fd */
void send_byte(int fd, unsigned char data) {
    write(fd, &data, 1);
}

/* write value to LCD */
void lcd_write(int fd, unsigned char value) {
    /* add backlight bit (0x08) to 0x0# (value is 0x#0) */
    send_byte(fd, value | 0x08);
    send_byte(fd, value | 0x0C);
    delay_microseconds(1);
    send_byte(fd, (value | 0x08) & 0xFB);
    delay_microseconds(50);
}

/* clear LCD */
void lcd_clear(int fd) {
    lcd_write(fd, 0x00);
    lcd_write(fd, 0x10);
    delay_microseconds(2000);
}

/* print text at lineNumber to LCD */
void lcd_print(int fd, char text[], int lineNumber) {
    int row_offsets[] = {0x80, 0xC0};
    lcd_write(fd, row_offsets[lineNumber] & 0xF0);
    lcd_write(fd, (row_offsets[lineNumber] << 4) & 0xF0);
    
    int i = 0;
    for (; i < 16 && text[i] != '\0'; i++) {
        lcd_write(fd, (text[i] & 0xF0) | 0x01);
        lcd_write(fd, ((text[i] << 4) & 0xF0) | 0x01);
    }
    for (; i < 16; i++) {
        lcd_write(fd, 0x21);
        lcd_write(fd, 0x01);
    }
}

/* close LCD */
void lcd_close(int fd) {
    lcd_clear(fd);
    close(fd);
}

/* get first or second 16-char chunks */
char *split16(char str[], int n) {
    char *back = malloc(17 * sizeof(char));
    int i, j = 0;
    for (i = 16 * n; i < 16 + 16 * n; ++i, ++j) back[j] = str[i];
    back[j] = '\0';
    return back;
}

/* concates a string with another */
char *concat(char str1[], char str2[]) {
    char *result = malloc(strlen(str1) + strlen(str2) + 1);
    strcpy(result, str1);
    strcat(result, str2);
    return result;
}

/* fits all of the text on the LCD */
void lcd_fit(int fd, char text[]) {
    char *first = split16(text, 0);
    lcd_print(fd, first, 0);
    free(first);
    if (strlen(text) > 16) {
        char *second = split16(text, 1);
        lcd_print(fd, second, 1);
        free(second);
    }
}

/* control LCD */
void *LCD(void *arg) {
    (void) arg;
    # define BUS 1
    # define ADDRESS 0x27
    int lcd_fd = open("/dev/i2c-" + BUS, O_RDWR);
    ioctl(lcd_fd, I2C_SLAVE, ADDRESS);

    // & (AND) means that the bits that are both one return 1, otherwise return 0
    // | (OR) means that the bits that are both zero return 0, otherwise return 1
    // ~ (NOT) means that each bit is reversed, 0s to 1s, 1s to 0s
    // ^ (XOR) means that the bits that are the same return 0 and the ones that are different return 1
    
    /* LCD initialization */
    lcd_write(lcd_fd, 0x30);
    delay_microseconds(4500);
    lcd_write(lcd_fd, 0x30);
    delay_microseconds(4500);
    lcd_write(lcd_fd, 0x30);
    delay_microseconds(150);
    lcd_write(lcd_fd, 0x20);
    
    lcd_write(lcd_fd, 0x20);
    lcd_write(lcd_fd, 0x80);
    lcd_write(lcd_fd, 0x00);
    lcd_write(lcd_fd, 0xC0);
    lcd_write(lcd_fd, 0x00);
    lcd_write(lcd_fd, 0x60);
    lcd_clear(lcd_fd);

    /* keypad config */
    int rowpins[] = {17, 27, 22, 23};
    int colpins[] = {24, 25, 5, 6};
    char keys[4][4] = {"123A", "456B", "789C", "*0#D"};
    char *letters[10] = {" ", ".,?!-:;'", "abc", "def", "ghi", "jkl", "mno", "pqrs", "tuv", "wxyz"};

    /* initialize gpios */
    struct gpiod_chip *chip = gpiod_chip_open("/dev/gpiochip0");
    struct gpiod_line *rows[4];
    struct gpiod_line *cols[4];
    for (int i = 0; i < 4; ++i) {
        rows[i] = gpiod_chip_get_line(chip, rowpins[i]);
        gpiod_line_request_output(rows[i], "keypad", 0);
    }
    struct gpiod_line_request_config config = {
        .consumer = "keypad",
        .request_type = GPIOD_LINE_REQUEST_DIRECTION_INPUT,
        .flags = GPIOD_LINE_REQUEST_FLAG_BIAS_PULL_DOWN
    };
    for (int i = 0; i < 4; ++i) {
        cols[i] = gpiod_chip_get_line(chip, colpins[i]);
        gpiod_line_request(cols[i], &config, 0);
    }

    /* keypad variables */
    char value[7] = "";
    char last = 0;
    int textMode = 0;
    time_t textTime;
    char textMessage[100] = "";
    int textLetterLength = 0;
    char textLetter = '\0';

    lcd_print(lcd_fd, "Init Code Done", 0);
    printf("Initial Code Completed");
    sleep(1);
    lcd_clear(lcd_fd);
    lcd_print(lcd_fd, "Passcode:", 0);

    /* detect keypresses until program ends */
    while (1) {
        char key = 0;
        for (int ci = 0; ci < 4; ci++) {
            gpiod_line_set_value(cols[ci], 1);
            struct timespec ts = {
                .tv_sec = 0,
                .tv_nsec = 1000000
            };
            nanosleep(&ts, NULL);
            
            for (int ri = 0; ri < 4; ri++) {
                if (gpiod_line_get_value(rows[ri]) == 1) {
                    key = keys[ri][ci];
                    break;
                }
            }
            
            gpiod_line_set_value(cols[ci], 0);
            if (key) break;
        }
        if (key && key != last) {
            if (textMode == 1) {
                if (isdigit(key) != 0 && strlen(textMessage) < 28) {
                    if (key != textLetter) {
                        if (textLetter) textMessage[strlen(textMessage)] = *letters[textLetter] + textLetterLength % strlen(letters[textLetter]);
                        textTime = time(NULL);
                        textLetterLength = 0;
                        textLetter = key;
                    } else textLetterLength++;
                    char *show = concat("msg:", textMessage);
                    lcd_fit(lcd_fd, show);
                    free(show);
                } else if (key == '*') {
                    if (strlen(textMessage) > 0) textMessage[strlen(textMessage) - 1] = '\0';
                    textTime = 0;
                    textLetterLength = 0;
                    textLetter = '\0';
                    lcd_clear(lcd_fd);
                    char *show = concat("msg:", textMessage);
                    lcd_fit(lcd_fd, show);
                    free(show);
                } else if (key == '#') {
                    /* Send Message */
                    /*
                    await addDoc(collection(db, "messages"), {
                        contactMethod: 'Door lock',
                        message: textMessage, 
                        createdAt: new Date()
                    });
                    */
                    printf("Message sent: %s", textMessage);
                    /* textReset() for reference*/
                    /* function textReset() {
                        textTime = null;
                        textLetterLength = 0;
                        textLetter = '\0';
                    } */
                    textTime = 0;
                    textLetterLength = 0;
                    textLetter = '\0';
                    textMessage[0] = '\0';
                    lcd_clear(lcd_fd);
                    lcd_print(lcd_fd, "Message Sent.", 0);
                    lcd_print(lcd_fd, "msg:", 0);
                } else if (key == 'B') {
                    textTime = 0;
                    textLetterLength = 0;
                    textLetter = '\0';
                    textMessage[0] = '\0';
                    textMode = 0;
                    lcd_clear(lcd_fd);
                    lcd_print(lcd_fd, "Texting mode off", 0);
                    sleep(1);
                    lcd_print(lcd_fd, "Passcode:", 0);
                }
            } else {
                switch (key) {
                    case '#':
                        /* parse dotenv values for prohibited and allowed */
                        if (env_load("./.env.local", false) == 0) {
                            lcd_print(lcd_fd, "File Error", 0);
                            printf("Error occurred while getting ./.env.local");
                            sleep(2);
                        } else if (strlen(value) < 6) {
                            lcd_print(lcd_fd, "6 digits only", 0);
                            printf("Incomplete passcode entered.");
                            sleep(2);
                        } else if (getenv((const char *)value) && atoi(getenv((const char *)value)) == 0) {
                            lcd_print(lcd_fd, "Prohibited.", 0);
                            printf("Prohibited passcode %s entered.", value);
                            sleep(2);
                        } else if (getenv((const char *)value) && atoi(getenv((const char *)value)) == 1) {
                            lcd_print(lcd_fd, "Unlocking...", 0);
                            printf("Allowed passcode %s entered.", value);
                            sleep(3);
                        } else {
                            lcd_print(lcd_fd, "Incorrect.", 0);
                            printf("Incorrect passcode %s entered.", value);
                            sleep(2);
                        }
                        lcd_print(lcd_fd, "Passcode:", 0);
                        value[0] = '\0';
                        break;
                    case '*':
                        if (strlen(value) > 0) value[strlen(value) - 1] = '\0';
                        char *show = concat("Passcode: ", value);
                        lcd_print(lcd_fd, show, 0);
                        free(show);
                        break;
                    case 'A':
                        lcd_print(lcd_fd, "Locking...", 0);
                        sleep(3);
                        show = concat("Passcode: ", value);
                        lcd_print(lcd_fd, show, 0);
                        free(show);
                        break;
                    case 'B':
                        value[0] = '\0';
                        textMode = 1;
                        lcd_print(lcd_fd, "Texting mode on.", 0);
                        sleep(1);
                        lcd_print(lcd_fd, "msg:", 0);
                        break;
                    default:
                        if (isdigit(key) && strlen(value) < 6) {
                            value[strlen(value)] = key;
                            char *show = concat("Passcode: ", value);
                            lcd_print(lcd_fd, show, 0);
                            free(show);
                        }
                        break;
                }
            }
            if (key == '#') printf("Action: Submitted.");
            else if (key == '*') printf("Action: Deleted.");
            else {
                char *show = concat(&key, " pressed");
                printf("Action: %s", show);
                free(show);
            }
        } else if (textMode == 1 && textTime != 0 && (time(NULL) - textTime >= 1) && strlen(textMessage) < 28) {
            if (textLetter) textMessage[strlen(textMessage)] = letters[textLetter][textLetterLength % strlen(letters[textLetter])];
            textMessage[strlen(textMessage)] = '\0';
            textTime = 0;
            textLetterLength = 0;
            textLetter = '\0';
            char *show = concat("msg:", textMessage);
            lcd_fit(lcd_fd, show);
            free(show);
            printf("Adding letter because of timeout.");
        }
        last = key;
        struct timespec ts = {
            .tv_sec = 0,
            .tv_nsec = 50000000
        };
        nanosleep(&ts, NULL);
    }
}

int main() {
    signal(SIGPIPE, SIG_IGN);
    cam = open_stream();
    server_fd = start_server();

    /* start LCD and keypad operations */
    pthread_t lcd;
    pthread_create(&lcd, NULL, LCD, NULL);
    pthread_detach(lcd);

    while (1) {
        int *client_fd = malloc(sizeof(int));
        *client_fd = accept(server_fd, NULL, NULL);
        if (*client_fd < 0) { perror("accept"); free(client_fd); continue; }

        pthread_t thread;
        pthread_create(&thread, NULL, handle_client, client_fd);
        pthread_detach(thread);
    }

    pclose(cam);
    close(server_fd);
    return 0;
}