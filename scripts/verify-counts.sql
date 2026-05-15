SELECT 'users'                  AS t, COUNT(*)::int AS n FROM users
UNION ALL SELECT 'permissions',        COUNT(*)::int    FROM permissions
UNION ALL SELECT 'role_permissions',   COUNT(*)::int    FROM role_permissions
UNION ALL SELECT 'razorpay_configurations', COUNT(*)::int FROM razorpay_configurations
UNION ALL SELECT 'enrollments',        COUNT(*)::int    FROM enrollments
UNION ALL SELECT 'payments',           COUNT(*)::int    FROM payments
UNION ALL SELECT 'followups',          COUNT(*)::int    FROM followups
UNION ALL SELECT 'audit_logs',         COUNT(*)::int    FROM audit_logs
UNION ALL SELECT 'webhook_delivery',   COUNT(*)::int    FROM webhook_delivery
UNION ALL SELECT 'refresh_tokens',     COUNT(*)::int    FROM refresh_tokens
UNION ALL SELECT 'course_master',      COUNT(*)::int    FROM course_master
UNION ALL SELECT 'duration_master',    COUNT(*)::int    FROM duration_master
UNION ALL SELECT 'education_master',   COUNT(*)::int    FROM education_master
UNION ALL SELECT 'plans',              COUNT(*)::int    FROM plans
UNION ALL SELECT 'plan_pricing',       COUNT(*)::int    FROM plan_pricing
ORDER BY t;
