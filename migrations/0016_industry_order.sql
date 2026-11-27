-- Industries: your own order (drag to reorder). Starts from the most common trades to the least.
ALTER TABLE industries ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
UPDATE industries SET position = 100 + id;
UPDATE industries SET position = CASE name
  WHEN 'Plumbers' THEN 1 WHEN 'HVAC Contractors' THEN 2 WHEN 'Roofers' THEN 3 WHEN 'Electricians' THEN 4
  WHEN 'Landscapers' THEN 5 WHEN 'General Contractors' THEN 6 WHEN 'Remodeling' THEN 7 WHEN 'House Cleaners' THEN 8
  WHEN 'Pest Control Companies' THEN 9 WHEN 'Painters' THEN 10 WHEN 'Movers' THEN 11 WHEN 'Handyman' THEN 12
  WHEN 'Tree Service' THEN 13 WHEN 'Garage Door Companies' THEN 14 WHEN 'Windows & Doors' THEN 15 WHEN 'Fence Installers' THEN 16
  WHEN 'Pressure Washing' THEN 17 WHEN 'Floor & Carpet Cleaning' THEN 18 WHEN 'Siding' THEN 19 WHEN 'Decks & Patios' THEN 20
  WHEN 'Paving' THEN 21 WHEN 'Pool Construction' THEN 22 WHEN 'Hardscaping' THEN 23 WHEN 'Dog Groomers' THEN 24
  ELSE position END;
