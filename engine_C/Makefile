CC := gcc
CFLAGS := -O2 -Wall -Wextra -I./include
LDFLAGS := -L/usr/lib64/mysql
LDLIBS := -lpcap -lmysqlclient -luuid -lcurl -lpthread

TARGET := gateguard_engine
INSTALL_PATH := /usr/local/bin/gg_engine
SERVICE_NAME := gateguard-engine

SRCS := \
	./src/main.c \
	./src/db_function.c \
	./src/decision_manager.c \
	./src/http_event_dispatch.c \
	./src/http_response_injector.c \
	./src/packet_extractor.c \
	./src/packet_forge_util.c \
	./src/packet_manager.c \
	./src/policy.c \
	./src/raw_socket_sender.c \
	./src/url_classification_client.c

OBJS := $(SRCS:.c=.o)

.PHONY: all clean rebuild install deploy restart status

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(OBJS) -o $@ $(LDFLAGS) $(LDLIBS)

./src/%.o: ./src/%.c
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(OBJS) $(TARGET)

rebuild: clean all

install: $(TARGET)
	sudo cp $(TARGET) $(INSTALL_PATH)
	sudo chmod 755 $(INSTALL_PATH)

deploy: rebuild
	sudo systemctl stop $(SERVICE_NAME)
	sudo cp $(TARGET) $(INSTALL_PATH)
	sudo chmod 755 $(INSTALL_PATH)
	sudo systemctl start $(SERVICE_NAME)

restart:
	sudo systemctl restart $(SERVICE_NAME)

status:
	systemctl status $(SERVICE_NAME) --no-pager
