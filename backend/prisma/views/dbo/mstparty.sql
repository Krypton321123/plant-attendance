SELECT
  led.ledcd,
  led.lednm,
  led.empcd,
  area.areacd,
  area.areanm,
  led.ledadr1,
  isnull(SUM(vou.amtdr - vou.amtcr), 0) AS outs,
  led.mobile
FROM
  APSPLUS_AOI_2021.dbo.mstlednfo_vw AS led
  JOIN APSPLUS_AOI_2021.dbo.mstareanfo_vw AS area ON area.areacd = led.areacd
  LEFT JOIN APSPLUS_AOI_2021.dbo.auto_voucher_vw AS vou ON vou.ledcd = led.ledcd
GROUP BY
  led.ledcd,
  led.lednm,
  led.empcd,
  area.areacd,
  area.areanm,
  led.ledadr1,
  led.mobile;