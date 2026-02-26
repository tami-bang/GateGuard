// src/url_classification_client.c
#include "url_classification_client.h"

#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#include <curl/curl.h>

static ai_client_config_t g_cfg;
static int g_inited = 0;

static int64_t now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (int64_t)ts.tv_sec * 1000 + (int64_t)ts.tv_nsec / 1000000;
}

typedef struct {
    char* buf;
    size_t len;
    size_t cap;
} mem_t;

static size_t write_cb(void* contents, size_t size, size_t nmemb, void* userp) {
    size_t realsize = size * nmemb;
    mem_t* m = (mem_t*)userp;
    if (!m || !m->buf) return 0;

    if (m->len + realsize + 1 > m->cap) {
        size_t newcap = (m->cap * 2) + realsize + 1;
        char* nb = (char*)realloc(m->buf, newcap);
        if (!nb) return 0;
        m->buf = nb;
        m->cap = newcap;
    }
    memcpy(m->buf + m->len, contents, realsize);
    m->len += realsize;
    m->buf[m->len] = '\0';
    return realsize;
}

// 매우 단순 JSON 추출: "key": <number>
static int json_get_double(const char* json, const char* key, double* out) {
    if (!json || !key || !out) return 0;
    char pat[64];
    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char* p = strstr(json, pat);
    if (!p) return 0;
    p = strchr(p, ':');
    if (!p) return 0;
    p++;
    while (*p == ' ' || *p == '\t') p++;
    char* endp = NULL;
    double v = strtod(p, &endp);
    if (endp == p) return 0;
    *out = v;
    return 1;
}

// 매우 단순 JSON 추출: "key":"string"
static int json_get_string(const char* json, const char* key, char* out, size_t outsz) {
    if (!json || !key || !out || outsz == 0) return 0;
    char pat[64];
    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char* p = strstr(json, pat);
    if (!p) return 0;
    p = strchr(p, ':');
    if (!p) return 0;
    p++;
    while (*p == ' ' || *p == '\t') p++;
    if (*p != '"') return 0;
    p++;
    const char* q = strchr(p, '"');
    if (!q) return 0;

    size_t n = (size_t)(q - p);
    if (n >= outsz) n = outsz - 1;
    memcpy(out, p, n);
    out[n] = '\0';
    return 1;
}

int ai_client_init(const ai_client_config_t* cfg) {
    if (!cfg) return 0;
    memset(&g_cfg, 0, sizeof(g_cfg));
    memcpy(&g_cfg, cfg, sizeof(ai_client_config_t));

    if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) {
        return 0;
    }
    g_inited = 1;
    return 1;
}

void ai_client_cleanup(void) {
    if (!g_inited) return;
    curl_global_cleanup();
    g_inited = 0;
}

static void out_reset(ai_result_t* out) {
    memset(out, 0, sizeof(*out));
    out->ok = 0;
    out->score = 0.0;
    out->http_status = 0;
    out->error_code = AI_ERR_EMPTY;
    out->latency_ms = 0;
    out->label[0] = '\0';
    out->model_version[0] = '\0';
    out->raw[0] = '\0';
}

int ai_classify_url_ex(const HttpEvent* ev, const char* request_id, ai_result_t* out) {
    if (!out) return 0;
    out_reset(out);

    if (!g_inited || g_cfg.endpoint[0] == '\0') {
        out->error_code = AI_ERR_CURL;
        snprintf(out->raw, sizeof(out->raw), "ai_client_not_initialized");
        return 0;
    }

    if (!ev || ev->host[0] == '\0') {
        out->error_code = AI_ERR_EMPTY;
        snprintf(out->raw, sizeof(out->raw), "empty_event");
        return 0;
    }

    // FastAPI ScoreRequest 스키마에 맞춤: request_id(optional), host, path
    // (path 없으면 "/")
    const char* path = (ev->path[0] ? ev->path : "/");

    char payload[1024];
    if (request_id && request_id[0]) {
        snprintf(payload, sizeof(payload),
                 "{\"request_id\":\"%s\",\"host\":\"%s\",\"path\":\"%s\"}",
                 request_id, ev->host, path);
    } else {
        snprintf(payload, sizeof(payload),
                 "{\"host\":\"%s\",\"path\":\"%s\"}",
                 ev->host, path);
    }

    CURL* curl = curl_easy_init();
    if (!curl) {
        out->error_code = AI_ERR_CURL;
        snprintf(out->raw, sizeof(out->raw), "curl_easy_init_failed");
        return 0;
    }

    struct curl_slist* headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    if (g_cfg.token[0] != '\0') {
        char auth[256];
        snprintf(auth, sizeof(auth), "Authorization: Bearer %s", g_cfg.token);
        headers = curl_slist_append(headers, auth);
    }

    mem_t mem;
    mem.cap = 4096;
    mem.len = 0;
    mem.buf = (char*)malloc(mem.cap);
    if (!mem.buf) {
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);
        out->error_code = AI_ERR_CURL;
        snprintf(out->raw, sizeof(out->raw), "malloc_failed");
        return 0;
    }
    mem.buf[0] = '\0';

    int64_t t0 = now_ms();

    curl_easy_setopt(curl, CURLOPT_URL, g_cfg.endpoint);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload);

    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, (long)g_cfg.connect_timeout_ms);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, (long)g_cfg.timeout_ms);

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, (void*)&mem);

    // 멀티스레드 안전 (timeout에서 SIGALRM 방지)
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

    CURLcode res = curl_easy_perform(curl);

    int64_t t1 = now_ms();
    out->latency_ms = (t1 - t0);

    long http_code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
    out->http_status = (int)http_code;

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        if (res == CURLE_OPERATION_TIMEDOUT) out->error_code = AI_ERR_TIMEOUT;
        else out->error_code = AI_ERR_CURL;

        snprintf(out->raw, sizeof(out->raw), "curl_error:%s", curl_easy_strerror(res));
        free(mem.buf);
        return 0;
    }

    if (http_code < 200 || http_code >= 300) {
        out->error_code = AI_ERR_HTTP;
        snprintf(out->raw, sizeof(out->raw), "%.*s",
                 (int)sizeof(out->raw) - 1, mem.buf ? mem.buf : "");
        free(mem.buf);
        return 0;
    }

    // parse JSON: score, label, model_version
    double score = 0.0;
    char label[32] = {0};
    char mv[64] = {0};

    int ok_score = json_get_double(mem.buf, "score", &score);
    int ok_label = json_get_string(mem.buf, "label", label, sizeof(label));
    int ok_mv    = json_get_string(mem.buf, "model_version", mv, sizeof(mv));

    if (!ok_score || !ok_label) {
        // invalid_test 같은 깨진 JSON은 여기로 들어옴
        out->error_code = AI_ERR_PARSE;
        snprintf(out->raw, sizeof(out->raw), "%.*s",
                 (int)sizeof(out->raw) - 1, mem.buf ? mem.buf : "");
        free(mem.buf);
        return 0;
    }

    out->ok = 1;
    out->error_code = AI_OK;
    out->score = score;
    strncpy(out->label, label, sizeof(out->label) - 1);
    if (ok_mv) strncpy(out->model_version, mv, sizeof(out->model_version) - 1);

    free(mem.buf);
    return 1;
}

int ai_classify_url(const HttpEvent* ev, ai_result_t* out) {
    // 기존 호출부 호환: request_id 없이 호출
    return ai_classify_url_ex(ev, NULL, out);
}
