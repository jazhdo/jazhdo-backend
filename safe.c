# include "pico/stdlib.h"
# include "pico/cyw43_arch.h"
# include "lwip/tcp.h"
# include "lwip/pbuf.h"
// # include "hardware/adc.h"
# include "hardware/i2c.h"
# include "lwip/netif.h"
# include "cyw43.h"
# include <string.h>

/* send_byte: send a byte to lcd */
void send_byte(i2c_inst_t *i2c, unsigned char data) {
    i2c_write_blocking(i2c, 0x27, &data, 1, false);
}

/* lcd_cmd: write command to LCD */
void lcd_cmd(i2c_inst_t *i2c, unsigned char val) {
    unsigned char high = (val & 0xF0) | 0x08;
    unsigned char low = ((val << 4) & 0xF0) | 0x08;
    send_byte(i2c, high);
    sleep_us(600);
    send_byte(i2c, high | 0x04);
    sleep_us(600);
    send_byte(i2c, high);
    sleep_us(600);
    send_byte(i2c, low);
    sleep_us(600);
    send_byte(i2c, low | 0x04);
    sleep_us(600);
    send_byte(i2c, low);
    sleep_us(600);
}

/* lcd_char: write char to LCD */
void lcd_char(i2c_inst_t *i2c, unsigned char val) {
    unsigned char high = 1 | (val & 0xF0) | 0x08;
    unsigned char low = 1 | ((val << 4) & 0xF0) | 0x08;
    send_byte(i2c, high);
    sleep_us(600);
    send_byte(i2c, high | 0x04);
    sleep_us(600);
    send_byte(i2c, high);
    sleep_us(600);
    send_byte(i2c, low);
    sleep_us(600);
    send_byte(i2c, low | 0x04);
    sleep_us(600);
    send_byte(i2c, low);
    sleep_us(600);
}

/* lcd_clear: clear LCD */
void lcd_clear(i2c_inst_t *i2c) {
    lcd_cmd(i2c, 0x01);
    sleep_ms(2);
}

/* initialize  */
void lcd_init(i2c_inst_t *i2c) {
    sleep_ms(50);
    lcd_cmd(i2c, 0x33);
    lcd_cmd(i2c, 0x32);
    lcd_cmd(i2c, 0x28);
    lcd_cmd(i2c, 0x0C);
    lcd_cmd(i2c, 0x06);
    lcd_clear(i2c);
    sleep_ms(2);
}

/* print text at lineNumber to LCD */
void lcd_print(i2c_inst_t *i2c, char text[], int lineNumber) {
    int row_offsets[] = {0x80, 0xC0};
    lcd_cmd(i2c, row_offsets[lineNumber]);

    for (int i = 0; i < 16 && text[i] != '\0'; i++) lcd_char(i2c, text[i]);
}

/* lcd_close: close LCD */
void lcd_close(i2c_inst_t *i2c) {
    lcd_clear(i2c);
    i2c_deinit(i2c);
}

#define WIFI_CONNECT_TIMEOUT_MS 60000
#define WIFI_CONNECT_RETRY_DELAY_MS 2000
#define WIFI_CONNECT_MAX_ATTEMPTS 3

static int connect_wifi_once(const char *ssid, const char *pw, uint32_t auth) {
    return cyw43_arch_wifi_connect_timeout_ms(ssid, pw, auth, WIFI_CONNECT_TIMEOUT_MS);
}

static int connect_wifi_with_fallback(const char *ssid, const char *pw) {
    uint32_t auth_modes[] = {
        CYW43_AUTH_WPA2_AES_PSK,
        CYW43_AUTH_WPA2_MIXED_PSK,
        CYW43_AUTH_WPA_TKIP_PSK
    };

    int last_error = PICO_ERROR_TIMEOUT;
    for (int i = 0; i < (int)(sizeof(auth_modes) / sizeof(auth_modes[0])); ++i) {
        int err = connect_wifi_once(ssid, pw, auth_modes[i]);
        if (err == PICO_OK) return err;
        last_error = err;
        if (err != PICO_ERROR_BADAUTH && err != PICO_ERROR_TIMEOUT) {
            return err;
        }
    }
    return last_error;
}

const char *http_response =
    "HTTP/1.1 200 OK\r\n"
    "Content-Type: text/html\r\n"
    "\r\n"
    "<!DOCTYPE HTML>"
    "<html>"
    "<head>"
    "</head>"
    "<body>"
        "<h1>Turn on/off Pico W LED</h1>"
        "<a href=\"/pin/on\">On</a>"
        "<a href=\"/pin/off\">Off</a>"
    "</body>"
    "</html>";

static err_t http_recv(void *arg, struct tcp_pcb *pcb, struct pbuf *p, err_t err) {
    if (p == 0) {
        tcp_close(pcb);
        return ERR_OK;
    }

    char req[128];
    int len = pbuf_copy_partial(p, req, sizeof(req) - 1, 0);
    req[len] = '\0';

    if (strstr(req, "GET /pin/on")) {
        cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, 1);
    } else if (strstr(req, "GET /pin/off")) {
        cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, 0);
    }

    tcp_write(pcb, http_response, strlen(http_response), TCP_WRITE_FLAG_COPY);
    tcp_output(pcb);
    pbuf_free(p);
    tcp_close(pcb);
    return ERR_OK;
}

static err_t http_accept(void *arg, struct tcp_pcb *pcb, err_t err) {
    tcp_recv(pcb, http_recv);
    return ERR_OK;
}

int main() {
    /* initialise I2C */
    i2c_init(i2c1, 100000);
    gpio_set_function(2, GPIO_FUNC_I2C); /* SDA */
    gpio_set_function(3, GPIO_FUNC_I2C); /* SCL */
    gpio_pull_up(2);
    gpio_pull_up(3);

    /* LCD initialization */
    lcd_init(i2c1);

    stdio_init_all();

    if (cyw43_arch_init() != 0) {
        lcd_print(i2c1, "WiFi init fail", 0);
        while (1);
    }

    cyw43_arch_enable_sta_mode();

    int wifi_result = PICO_ERROR_TIMEOUT;
    for (int attempt = 1; attempt <= WIFI_CONNECT_MAX_ATTEMPTS; ++attempt) {
        char status[16];
        sprintf(status, "WiFi try %d", attempt);
        lcd_print(i2c1, status, 0);

        wifi_result = connect_wifi_with_fallback(WIFI_SSID, WIFI_PASSWORD);
        if (wifi_result == PICO_OK) break;

        if (attempt < WIFI_CONNECT_MAX_ATTEMPTS) {
            cyw43_arch_disable_sta_mode();
            sleep_ms(100);
            cyw43_arch_enable_sta_mode();
            sleep_ms(WIFI_CONNECT_RETRY_DELAY_MS);
        }
    }

    if (wifi_result != PICO_OK) {
        char err_str[16];
        if (wifi_result == PICO_ERROR_BADAUTH) {
            sprintf(err_str, "BadAuth");
        } else if (wifi_result == PICO_ERROR_TIMEOUT) {
            sprintf(err_str, "Timeout");
        } else {
            sprintf(err_str, "Err:%d", wifi_result);
        }
        lcd_print(i2c1, err_str, 0);
        lcd_print(i2c1, "WiFi failed", 1);
        while (1);
    }

    char result_str[16];
    sprintf(result_str, "R:%d", wifi_result);
    lcd_print(i2c1, result_str, 1);

    cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, 1);

    lcd_print(i2c1, "Init Done", 0);

    absolute_time_t timeout = make_timeout_time_ms(10000);
    while (netif_default == NULL || netif_ip4_addr(netif_default)->addr == 0) {
        cyw43_arch_poll();
        sleep_ms(10);
        if (absolute_time_diff_us(get_absolute_time(), timeout) <= 0) {
            lcd_print(i2c1, "DHCP Failed", 0);
            sprintf(result_str, "R:%d", wifi_result);
            lcd_print(i2c1, result_str, 1);
            while(1);
        }
    }
    lcd_print(i2c1, "IP Done", 0);
    char ip_str[16];
    ip4addr_ntoa_r(netif_ip4_addr(netif_default), ip_str, 16);
    lcd_print(i2c1, ip_str, 1);

    /* get mac addr */
    uint8_t mac[6];
    cyw43_hal_get_mac(0, mac);
    char mac_str[13];
    sprintf(mac_str, "%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    lcd_print(i2c1, mac_str, 0);
    sleep_ms(2000);

    struct tcp_pcb *pcb = tcp_new();
    if (!pcb) {
        lcd_print(i2c1, "TCP alloc fail", 0);
        while (1);
    }

    if (tcp_bind(pcb, IP_ADDR_ANY, 80) != ERR_OK) {
        lcd_print(i2c1, "TCP bind fail", 0);
        while (1);
    }

    pcb = tcp_listen(pcb);
    if (!pcb) {
        lcd_print(i2c1, "TCP listen fail", 0);
        while (1);
    }

    tcp_accept(pcb, http_accept);

    while (1) {
        cyw43_arch_poll();
        sleep_ms(1);
        // lcd_print(i2c1, "hello!", 0);
        // sleep_ms(500);
    }
}