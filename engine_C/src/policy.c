#include "policy.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <regex.h>

/* ---------- 유틸 ---------- */

static int streq_ci(const char* a, const char* b)
{
    if (!a || !b) return 0;
    while (*a && *b) {
        if (tolower((unsigned char)*a) != tolower((unsigned char)*b)) return 0;
        a++; b++;
    }
    return (*a == '\0' && *b == '\0');
}

static int starts_with(const char* s, const char* p, int case_sensitive)
{
    if (!s || !p) return 0;
    size_t ps = strlen(p);
    if (strlen(s) < ps) return 0;

    if (case_sensitive) return (strncmp(s, p, ps) == 0);

    for (size_t i = 0; i < ps; i++) {
        if (tolower((unsigned char)s[i]) != tolower((unsigned char)p[i])) return 0;
    }
    return 1;
}

static int contains_substr(const char* s, const char* sub, int case_sensitive)
{
    if (!s || !sub) return 0;

    if (case_sensitive) return (strstr(s, sub) != NULL);

    /* case-insensitive strstr */
    size_t n = strlen(s);
    size_t m = strlen(sub);
    if (m == 0) return 1;
    if (n < m) return 0;

    for (size_t i = 0; i + m <= n; i++) {
        size_t k = 0;
        for (; k < m; k++) {
            if (tolower((unsigned char)s[i+k]) != tolower((unsigned char)sub[k])) break;
        }
        if (k == m) return 1;
    }
    return 0;
}

static int match_regex(const char* s, const char* pat, int case_sensitive)
{
    if (!s || !pat) return 0;

    regex_t re;
    int cflags = REG_EXTENDED | REG_NOSUB;
    if (!case_sensitive) cflags |= REG_ICASE;

    if (regcomp(&re, pat, cflags) != 0) return 0;
    int ok = (regexec(&re, s, 0, NULL, 0) == 0);
    regfree(&re);
    return ok;
}

static int rule_match_one(const policy_rule_t* r,
                          const char* host,
                          const char* path,
                          const char* url_norm)
{
    if (!r || !r->is_enabled) return 0;

    const char* target = NULL;
    if (r->rule_type == RT_HOST) target = host;
    else if (r->rule_type == RT_PATH) target = path;
    else target = url_norm;

    if (!target) target = "";

    int case_sensitive = (r->is_case_sensitive != 0);
    int matched = 0;

    switch (r->match_type) {
        case MT_EXACT:
            matched = case_sensitive ? (strcmp(target, r->pattern) == 0) : streq_ci(target, r->pattern);
            break;
        case MT_PREFIX:
            matched = starts_with(target, r->pattern, case_sensitive);
            break;
        case MT_CONTAINS:
            matched = contains_substr(target, r->pattern, case_sensitive);
            break;
        case MT_REGEX:
            matched = match_regex(target, r->pattern, case_sensitive);
            break;
        default:
            matched = 0;
            break;
    }

    if (r->is_negated) matched = !matched;
    return matched;
}

static action_t action_from_str(const char* s)
{
    if (!s) return ACT_UNKNOWN;
    if (strcasecmp(s, "ALLOW") == 0) return ACT_ALLOW;
    if (strcasecmp(s, "BLOCK") == 0) return ACT_BLOCK;
    if (strcasecmp(s, "REDIRECT") == 0) return ACT_REDIRECT;
    if (strcasecmp(s, "REVIEW") == 0) return ACT_REVIEW;
    return ACT_UNKNOWN;
}

static rule_type_t rule_type_from_str(const char* s)
{
    if (!s) return RT_HOST;
    if (strcasecmp(s, "HOST") == 0) return RT_HOST;
    if (strcasecmp(s, "PATH") == 0) return RT_PATH;
    if (strcasecmp(s, "URL")  == 0) return RT_URL;
    return RT_HOST;
}

static match_type_t match_type_from_str(const char* s)
{
    if (!s) return MT_EXACT;
    if (strcasecmp(s, "EXACT") == 0) return MT_EXACT;
    if (strcasecmp(s, "PREFIX") == 0) return MT_PREFIX;
    if (strcasecmp(s, "CONTAINS") == 0) return MT_CONTAINS;
    if (strcasecmp(s, "REGEX") == 0) return MT_REGEX;
    return MT_EXACT;
}

/* ---------- 정책 캐시 ---------- */

void free_policy_cache(policy_cache_t* cache)
{
    if (!cache) return;

    for (size_t i = 0; i < cache->policy_count; i++) {
        free(cache->policies[i].rules);
        cache->policies[i].rules = NULL;
        cache->policies[i].rule_count = 0;
    }

    free(cache->policies);
    cache->policies = NULL;
    cache->policy_count = 0;
}

static MYSQL* policy_db_connect(const char* host, int port, const char* user, const char* pass, const char* db)
{
    MYSQL* conn = mysql_init(NULL);
    if (!conn) return NULL;

    mysql_options(conn, MYSQL_SET_CHARSET_NAME, "utf8mb4");

    unsigned int proto = MYSQL_PROTOCOL_TCP;
    mysql_options(conn, MYSQL_OPT_PROTOCOL, &proto);

    if (!mysql_real_connect(conn, host, user, pass, db, port, NULL, 0)) {
        fprintf(stderr, "[POLICY_DB] connect failed: %s\n", mysql_error(conn));
        mysql_close(conn);
        return NULL;
    }

    fprintf(stderr, "[POLICY_DB] host=%s port=%d user=%s db=%s\n", host, port, user, db);
    fprintf(stderr, "[POLICY_DB] connected via: %s\n", mysql_get_host_info(conn));
    return conn;
}

int load_policy_cache(policy_cache_t* cache,
                      const char* host,
                      int port,
                      const char* user,
                      const char* pass,
                      const char* db)
{
    if (!cache) return -1;

    free_policy_cache(cache);

    MYSQL* conn = policy_db_connect(host, port, user, pass, db);
    if (!conn) return -1;

    /*
     * policy: is_enabled=1 인 것만
     * - policy_id, policy_name, policy_type, action, priority, is_enabled, risk_level, category, block_status_code, redirect_url
     */
    const char* q1 =
        "SELECT policy_id, policy_name, policy_type, action, priority, is_enabled, "
        "       risk_level, category, block_status_code, redirect_url "
        "FROM policy "
        "WHERE is_enabled=1 "
        "ORDER BY priority DESC, policy_id ASC";

    if (mysql_query(conn, q1) != 0) {
        fprintf(stderr, "[POLICY_DB] query policy failed: %s\n", mysql_error(conn));
        mysql_close(conn);
        return -1;
    }

    MYSQL_RES* res = mysql_store_result(conn);
    if (!res) {
        fprintf(stderr, "[POLICY_DB] store_result failed: %s\n", mysql_error(conn));
        mysql_close(conn);
        return -1;
    }

    size_t n = (size_t)mysql_num_rows(res);
    cache->policies = (policy_t*)calloc(n, sizeof(policy_t));
    cache->policy_count = 0;

    MYSQL_ROW row;
    while ((row = mysql_fetch_row(res)) != NULL) {
        policy_t* p = &cache->policies[cache->policy_count];

        p->policy_id = row[0] ? atoll(row[0]) : 0;
        snprintf(p->policy_name, sizeof(p->policy_name), "%s", row[1] ? row[1] : "");
        snprintf(p->policy_type, sizeof(p->policy_type), "%s", row[2] ? row[2] : "");
        p->action = action_from_str(row[3]);
        p->priority = row[4] ? atoi(row[4]) : 0;
        p->is_enabled = row[5] ? atoi(row[5]) : 1;
        snprintf(p->risk_level, sizeof(p->risk_level), "%s", row[6] ? row[6] : "");
        snprintf(p->category, sizeof(p->category), "%s", row[7] ? row[7] : "");
        p->block_status_code = row[8] ? atoi(row[8]) : 403;
        snprintf(p->redirect_url, sizeof(p->redirect_url), "%s", row[9] ? row[9] : "");

        p->rules = NULL;
        p->rule_count = 0;

        cache->policy_count++;
    }

    mysql_free_result(res);

    /*
     * policy_rule: is_enabled=1 인 룰을 policy_id별로 읽어서 각 policy.rules에 넣음
     * - rule_id, policy_id, rule_type, match_type, pattern, is_case_sensitive, is_negated, rule_order, is_enabled
     */
    const char* q2 =
        "SELECT rule_id, policy_id, rule_type, match_type, pattern, "
        "       is_case_sensitive, is_negated, rule_order, is_enabled "
        "FROM policy_rule "
        "WHERE is_enabled=1 "
        "ORDER BY policy_id ASC, rule_order ASC, rule_id ASC";

    if (mysql_query(conn, q2) != 0) {
        fprintf(stderr, "[POLICY_DB] query policy_rule failed: %s\n", mysql_error(conn));
        mysql_close(conn);
        free_policy_cache(cache);
        return -1;
    }

    MYSQL_RES* res2 = mysql_store_result(conn);
    if (!res2) {
        fprintf(stderr, "[POLICY_DB] store_result(rule) failed: %s\n", mysql_error(conn));
        mysql_close(conn);
        free_policy_cache(cache);
        return -1;
    }

    /* 1-pass: policy별 rule_count 계산 */
    size_t* counts = (size_t*)calloc(cache->policy_count, sizeof(size_t));
    if (!counts) {
        mysql_free_result(res2);
        mysql_close(conn);
        free_policy_cache(cache);
        return -1;
    }

    MYSQL_ROW rrow;
    while ((rrow = mysql_fetch_row(res2)) != NULL) {
        long long pid = rrow[1] ? atoll(rrow[1]) : 0;
        for (size_t i = 0; i < cache->policy_count; i++) {
            if (cache->policies[i].policy_id == pid) {
                counts[i]++;
                break;
            }
        }
    }

    /* allocate rules */
    for (size_t i = 0; i < cache->policy_count; i++) {
        if (counts[i] > 0) {
            cache->policies[i].rules = (policy_rule_t*)calloc(counts[i], sizeof(policy_rule_t));
            cache->policies[i].rule_count = 0;
        }
    }

    /* 2-pass: fill */
    mysql_data_seek(res2, 0);
    while ((rrow = mysql_fetch_row(res2)) != NULL) {
        policy_rule_t rr;
        memset(&rr, 0, sizeof(rr));

        rr.rule_id = rrow[0] ? atoll(rrow[0]) : 0;
        rr.policy_id = rrow[1] ? atoll(rrow[1]) : 0;
        rr.rule_type = rule_type_from_str(rrow[2]);
        rr.match_type = match_type_from_str(rrow[3]);
        snprintf(rr.pattern, sizeof(rr.pattern), "%s", rrow[4] ? rrow[4] : "");
        rr.is_case_sensitive = rrow[5] ? atoi(rrow[5]) : 0;
        rr.is_negated = rrow[6] ? atoi(rrow[6]) : 0;
        rr.rule_order = rrow[7] ? atoi(rrow[7]) : 0;
        rr.is_enabled = rrow[8] ? atoi(rrow[8]) : 1;

        for (size_t i = 0; i < cache->policy_count; i++) {
            if (cache->policies[i].policy_id == rr.policy_id && cache->policies[i].rules) {
                size_t idx = cache->policies[i].rule_count;
                cache->policies[i].rules[idx] = rr;
                cache->policies[i].rule_count++;
                break;
            }
        }
    }

    free(counts);
    mysql_free_result(res2);
    mysql_close(conn);

    return 0;
}

policy_decision_t match_policy(const policy_cache_t* cache,
                               const char* host,
                               const char* path,
                               const char* url_norm)
{
    policy_decision_t d;
    memset(&d, 0, sizeof(d));

    if (!cache || cache->policy_count == 0) return d;

    const char* h = host ? host : "";
    const char* p = path ? path : "/";
    const char* u = url_norm ? url_norm : "";

    for (size_t i = 0; i < cache->policy_count; i++) {
        const policy_t* pol = &cache->policies[i];
        if (!pol->is_enabled) continue;

        /* 룰이 0개면 매칭 불가 */
        if (!pol->rules || pol->rule_count == 0) continue;

        int any_match = 0;
        for (size_t k = 0; k < pol->rule_count; k++) {
            if (rule_match_one(&pol->rules[k], h, p, u)) {
                any_match = 1;
                break;
            }
        }

        if (any_match) {
            d.matched = 1;
            d.policy_id = pol->policy_id;
            d.action = pol->action;
            d.block_status_code = (pol->block_status_code > 0 ? pol->block_status_code : 403);
            snprintf(d.redirect_url, sizeof(d.redirect_url), "%s", pol->redirect_url);
            return d;
        }
    }

    return d;
}
