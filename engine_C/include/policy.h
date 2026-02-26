#ifndef POLICY_H
#define POLICY_H

#include <stddef.h>
#include <mysql/mysql.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    ACT_UNKNOWN = 0,
    ACT_ALLOW,
    ACT_BLOCK,
    ACT_REDIRECT,
    ACT_REVIEW
} action_t;

typedef enum {
    RT_HOST = 0,
    RT_PATH,
    RT_URL
} rule_type_t;

typedef enum {
    MT_EXACT = 0,
    MT_PREFIX,
    MT_CONTAINS,
    MT_REGEX
} match_type_t;

typedef struct {
    long long    rule_id;
    long long    policy_id;
    rule_type_t  rule_type;
    match_type_t match_type;
    char         pattern[512];

    int          is_case_sensitive;
    int          is_negated;
    int          rule_order;
    int          is_enabled;
} policy_rule_t;

typedef struct {
    long long    policy_id;
    char         policy_name[128];
    char         policy_type[32];
    action_t     action;

    int          priority;
    int          is_enabled;

    char         risk_level[16];
    char         category[64];

    int          block_status_code;
    char         redirect_url[512];

    policy_rule_t* rules;
    size_t         rule_count;
} policy_t;

typedef struct {
    policy_t* policies;
    size_t    policy_count;
} policy_cache_t;

typedef struct {
    int       matched;
    long long policy_id;
    action_t  action;
    int       block_status_code;
    char      redirect_url[512];
} policy_decision_t;

/* 정책 캐시 로드/해제/매칭 */
int  load_policy_cache(policy_cache_t* cache,
                       const char* host,
                       int port,
                       const char* user,
                       const char* pass,
                       const char* db);

void free_policy_cache(policy_cache_t* cache);

policy_decision_t match_policy(const policy_cache_t* cache,
                               const char* host,
                               const char* path,
                               const char* url_norm);

#ifdef __cplusplus
}
#endif

#endif // POLICY_H
