SELECT
  d.deal_id,
  d.deal_pipeline_stage_id,
  s.label AS stage_label,
  d.property_amount,
  d.property_closedate
FROM {{ source('hubspot', 'deal') }} d
JOIN {{ source('hubspot', 'deal_pipeline_stage') }} s
  ON d.deal_pipeline_stage_id = s.stage_id
WHERE s.stage_id = 'contractsent'
  AND NOT d._fivetran_deleted
