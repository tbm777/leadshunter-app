-- Accepted Google categories set from real Google Maps results (each industry's first two terms in Austin and Atlanta,
-- about 1,500 results): categories Google actually uses for these businesses, unseen guesses removed.
UPDATE industries SET categories = '["Plumber", "Drainage service"]' WHERE name = 'Plumbers';
UPDATE industries SET categories = '["HVAC contractor", "Air conditioning repair service", "Air conditioning contractor"]' WHERE name = 'HVAC Contractors';
UPDATE industries SET categories = '["Roofing contractor"]' WHERE name = 'Roofers';
UPDATE industries SET categories = '["Electrician", "Electrical installation service", "Electric vehicle charging station contractor"]' WHERE name = 'Electricians';
UPDATE industries SET categories = '["Lawn care service", "Landscaper", "Landscape designer", "Landscape architect", "Lawn sprinkler system contractor", "Landscape lighting designer"]' WHERE name = 'Landscapers';
UPDATE industries SET categories = '["General contractor", "Custom home builder", "Home builder", "Construction company", "Contractor"]' WHERE name = 'General Contractors';
UPDATE industries SET categories = '["Kitchen remodeler", "Bathroom remodeler", "Remodeler", "General contractor", "Contractor"]' WHERE name = 'Remodeling';
UPDATE industries SET categories = '["House cleaning service", "Cleaning service", "Cleaners"]' WHERE name = 'House Cleaners';
UPDATE industries SET categories = '["Pest control service", "Animal control service"]' WHERE name = 'Pest Control Companies';
UPDATE industries SET categories = '["Painter", "Painting"]' WHERE name = 'Painters';
UPDATE industries SET categories = '["Mover", "Moving and storage service"]' WHERE name = 'Movers';
UPDATE industries SET categories = '["Handyman/Handywoman/Handyperson", "Property maintenance"]' WHERE name = 'Handyman';
UPDATE industries SET categories = '["Tree service", "Arborist service"]' WHERE name = 'Tree Service';
UPDATE industries SET categories = '["Garage door supplier"]' WHERE name = 'Garage Door Companies';
UPDATE industries SET categories = '["Window installation service", "Door supplier", "Window supplier"]' WHERE name = 'Windows & Doors';
UPDATE industries SET categories = '["Pressure washing service"]' WHERE name = 'Pressure Washing';
UPDATE industries SET categories = '["Carpet cleaning service", "Tile cleaning service", "Floor refinishing service"]' WHERE name = 'Floor & Carpet Cleaning';
UPDATE industries SET categories = '["Siding contractor"]' WHERE name = 'Siding';
UPDATE industries SET categories = '["Deck builder", "Carport and pergola builder"]' WHERE name = 'Decks & Patios';
UPDATE industries SET categories = '["Asphalt contractor", "Paving contractor", "Concrete contractor"]' WHERE name = 'Paving';
UPDATE industries SET categories = '["Swimming pool contractor"]' WHERE name = 'Pool Construction';
UPDATE industries SET categories = '["Landscaper", "Landscape designer", "Paving contractor", "Landscape architect", "Masonry contractor"]' WHERE name = 'Hardscaping';
UPDATE industries SET categories = '["Pet groomer"]' WHERE name = 'Dog Groomers';
UPDATE industries SET terms = '["electrician", "electrical contractor", "lighting contractor"]' WHERE name = 'Electricians';
UPDATE industries SET terms = '["pressure washing service", "power washing", "soft washing"]' WHERE name = 'Pressure Washing';
