cmake_minimum_required(VERSION 3.13)

include($ENV{PICO_SDK_PATH}/pico_sdk_init.cmake)

include(credentials.cmake)

project(my_project)

pico_sdk_init()

add_executable(my_project
    safe.c
)

target_link_libraries(my_project pico_stdlib pico_cyw43_arch_lwip_threadsafe_background hardware_i2c)

target_compile_definitions(my_project PRIVATE
    WIFI_SSID="${WIFI_SSID}"
    WIFI_PASSWORD="${WIFI_PASSWORD}"
)

pico_add_extra_outputs(my_project)