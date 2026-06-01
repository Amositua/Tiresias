SELECT
  stage_name,
  COUNT(*) AS deal_count,
  SUM(property_amount) AS pipeline_value,
  SUM(CASE WHEN property_closedate >= CURRENT_DATE() THEN property_amount ELSE 0 END) AS active_pipeline_value
FROM {{ ref('stg_deals') }}
GROUP BY stage_name
