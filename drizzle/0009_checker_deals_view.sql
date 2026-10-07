-- Finance checkers approve protected-deal settlements from the deal page, which needs read-only deal access.
-- Additive, one-time grant (editable afterwards); nothing is removed.
INSERT INTO role_permissions (role_code, permission)
SELECT code, 'deals.view' FROM roles WHERE code = 'FINANCE_CHECKER'
ON CONFLICT DO NOTHING;
