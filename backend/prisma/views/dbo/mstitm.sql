SELECT
  DISTINCT itm.rowid,
  itm.itmcd,
  itm.itmnm,
  itm.pcksz,
  itm.wgtconv,
  itm.itmsubcat,
  itm.itmcatgrp,
  itm.lsitmnm,
  168 AS itmrate,
  pckcstdet.curcstamt
FROM
  APSPLUS_AOI_2021.dbo.mstitmnfo_vw AS itm
  LEFT JOIN APSPLUS_AOI_2021.dbo.mstpckcstdetnfo_vw AS pckcstdet ON pckcstdet.itmcd = itm.itmcd
  AND pckcstdet.sts = 'Active'
WHERE
  (itm.itmnm LIKE 'saavli_m%')
  OR (
    itm.itmnm IN (
      'Tin_mustard_oil_15_kg._saavli',
      'Tin_mustard_oil_15_ltr_saavli'
    )
  );