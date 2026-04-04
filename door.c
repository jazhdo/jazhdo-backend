# include <stdio.h>
# include <stdlib.h>
# include <string.h>
# include <fcntl.h>
# include <unistd.h>
# include <errno.h>
# include <sys/ioctl.h>
# include <sys/mman.h>
# include <linux/videodev2.h>

# define DEVICE "/dev/video0"
# define WIDTH 2304
# define HEIGHT 1296
# define NBUFS 4
# define FMT v4l2_fourcc('p', 'R', 'A', 'A')

struct buf {
    void * start;
    size_t len;
};

static int xioctl(int fd, unsigned long req, void *arg) {
    int r;
    do {
        r = ioctl(fd, req, arg);
    } while (r == -1 && errno == EINTR);
    return r;
}

void configure_pipeline() {
    if (system("media-ctl -d /dev/media0 -V '\"imx708\":0 [fmt:SRGGB10_1X10/2304x1296 field:none];'") != 0) {
        fprintf(stderr, "pipeline config failed\n");
    };
}

FILE *open_ffmpeg() {
    FILE *pipe = popen("ffmpeg -f rawvideo -pixel_format bayer_rggb16le -video_size 2304x1296 -framerate 30 -i pipe:0 -f mjpeg pipe:1", "w");
    if (!pipe) {
        fprintf(stderr, "failed to open ffmpeg\n");
        exit(1);
    }
    return pipe;
}

int main() {
    FILE *ffmpeg = open_ffmpeg();
    configure_pipeline();

    /* open device */
    int fd = open(DEVICE, O_RDWR | O_NONBLOCK);
    if (fd < 0) {
        perror("open");
        return 1;
    }

    /* set format */
    struct v4l2_format fmt = {0};
    fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    fmt.fmt.pix.width = WIDTH;
    fmt.fmt.pix.height = HEIGHT;
    fmt.fmt.pix.pixelformat = FMT;
    fmt.fmt.pix.field = V4L2_FIELD_NONE;
    if (xioctl(fd, VIDIOC_S_FMT, &fmt) < 0) {
        perror("S_FMT");
        return 1;
    }

    /* request buffers */
    struct v4l2_requestbuffers req = {0};
    req.count = NBUFS;
    req.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    req.memory = V4L2_MEMORY_MMAP;
    if (xioctl(fd, VIDIOC_REQBUFS, &req) < 0) {
        perror("S_FMT");
        return 1;
    }

    /* mmap buffers */
    struct buf bufs[NBUFS];
    for (int i = 0; i < NBUFS; i++) {
        struct v4l2_buffer b = {0};
        b.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        b.memory = V4L2_MEMORY_MMAP;
        b.index = i;
        if (xioctl(fd, VIDIOC_QUERYBUF, &b) < 0) {
            perror("QUERYBUF");
            return 1;
        }
        bufs[i].len = b.length;
        bufs[i].start = mmap(NULL, b.length, PROT_READ | PROT_WRITE, MAP_SHARED, fd, b.m.offset);
        if (bufs[i].start == MAP_FAILED) {
            perror("mmap");
            return 1;
        }
    }

    /* queue buffers */
    for (int i = 0; i < NBUFS; i++) {
        struct v4l2_buffer b = {0};
        b.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        b.memory = V4L2_MEMORY_MMAP;
        b.index = i;
        if (xioctl(fd, VIDIOC_QBUF, &b) < 0) {
            perror("QBUF");
            return 1;
        }
    }

    /* start streaming */
    enum v4l2_buf_type type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    if (xioctl(fd, VIDIOC_STREAMON, &type) < 0) {
        perror("STREAMON");
        return 1;
    }

    printf("streaming on %s %dx%d\n", DEVICE, WIDTH, HEIGHT);

    /* capture loop */
    while (1) {
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(fd, &fds);
        struct timeval tv = {5, 0};
        if (select(fd + 1, &fds, NULL, NULL, &tv) <= 0) {
            perror("select");
            break;
        }

        struct v4l2_buffer b = {0};
        b.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        b.memory = V4L2_MEMORY_MMAP;
        if (xioctl(fd, VIDIOC_DQBUF, &b) < 0) {
            perror("DQBUF");
            break;
        }

        /* raw frame ? write to stdout */
        fwrite(bufs[b.index].start, 1, b.bytesused, ffmpeg);
        fflush(ffmpeg);

        if (xioctl(fd, VIDIOC_QBUF, &b) < 0) {
            perror("QBUF requeue");
            break;
        }
    }

    /* cleanup */
    xioctl(fd, VIDIOC_STREAMOFF, &type);
    for (int i = 0; i < NBUFS; i++) munmap(bufs[i].start, bufs[i].len);
    close(fd);
    pclose(ffmpeg);
    return 0;
}