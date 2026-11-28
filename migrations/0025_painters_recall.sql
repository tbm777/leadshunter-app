-- Recall first: two painting trades that a whole-state Texas run dropped by category come back for Painters.
UPDATE industries SET categories = json_insert(categories, '$[#]', 'Paint stripping service') WHERE name = 'Painters' AND NOT EXISTS (SELECT 1 FROM json_each(categories) WHERE lower(value) = lower('Paint stripping service'));
UPDATE industries SET categories = json_insert(categories, '$[#]', 'Wallpaper installer') WHERE name = 'Painters' AND NOT EXISTS (SELECT 1 FROM json_each(categories) WHERE lower(value) = lower('Wallpaper installer'));
