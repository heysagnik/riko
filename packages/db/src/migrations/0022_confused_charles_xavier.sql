CREATE TEMP TABLE dup_customers AS
SELECT (array_agg(id ORDER BY id))[1] AS keep_id, tenant_id, provider_id, provider_customer_id, array_agg(id) AS dup_ids
FROM customers
GROUP BY tenant_id, provider_id, provider_customer_id
HAVING count(*) > 1;
--> statement-breakpoint
UPDATE cases cs SET customer_id = d.keep_id
FROM dup_customers d
WHERE cs.customer_id = ANY (d.dup_ids) AND cs.customer_id <> d.keep_id;
--> statement-breakpoint
UPDATE exposures e SET customer_id = d.keep_id
FROM dup_customers d
WHERE e.customer_id = ANY (d.dup_ids) AND e.customer_id <> d.keep_id;
--> statement-breakpoint
UPDATE payments p SET customer_id = d.keep_id
FROM dup_customers d
WHERE p.customer_id = ANY (d.dup_ids) AND p.customer_id <> d.keep_id;
--> statement-breakpoint
DELETE FROM customers c
USING dup_customers d
WHERE d.tenant_id = c.tenant_id
  AND d.provider_id = c.provider_id
  AND d.provider_customer_id = c.provider_customer_id
  AND c.id <> d.keep_id;
--> statement-breakpoint
DROP TABLE dup_customers;
--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_provider_uidx" ON "customers" USING btree ("tenant_id","provider_id","provider_customer_id");
