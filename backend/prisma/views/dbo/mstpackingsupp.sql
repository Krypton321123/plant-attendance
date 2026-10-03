SELECT
  led.ledcd,
  led.lednm,
  led.ledadr1,
  led.mobile
FROM
  APSPLUS_MLS_2021.dbo.mstlednfo_vw AS led
  JOIN APSPLUS_MLS_2021.dbo.mstledctdetnfo AS ledct ON ledct.ledcd = led.ledcd
WHERE
  ledct.ledctcd = 'LCTA00071';