-- Seed 25 design concepts per category (75 total). concept_prompt is the
-- base text fed into the AI Design Generator (api/_lib/solitaireImageGen.js)
-- along with the admin-picked shape/gold-colour/carat filters at generation
-- time — these are style directions, not full image prompts.

WITH styles(design_number, style_name, style_prompt, side_diamonds) AS (
  VALUES
    (1,  'Classic Solitaire',        'a timeless minimalist solitaire setting, thin polished band, prongs barely visible, the diamond is the sole focus', false),
    (2,  'Royal Halo',               'a halo of small pave diamonds encircling the center stone, ornate but balanced, royal courtly feel', true),
    (3,  'Cathedral Arch',           'cathedral-style shoulders rising to cradle the center stone, architectural arches, refined', false),
    (4,  'Vintage Milgrain',         'antique milgrain beaded edge detailing along the band, vintage Edwardian character', false),
    (5,  'Twisted Vine',             'a delicate twisted rope/vine pattern band spiraling toward the setting', false),
    (6,  'Modern Bezel',             'a sleek flush bezel setting, contemporary minimal lines, no visible prongs', false),
    (7,  'Art Deco Geometric',       'bold geometric Art Deco lines, symmetrical stepped facets around the center stone', true),
    (8,  'Floral Bloom',             'a floral motif with petal-shaped prongs or accents cradling the center stone', false),
    (9,  'Trellis Weave',            'an open lattice/trellis weave under the setting, airy and light-catching', false),
    (10, 'Split Shank',              'a split-shank band that divides and rejoins at the setting, dynamic silhouette', false),
    (11, 'Pave Shoulder',            'a plain center setting with a pave-set diamond shoulder trail leading into it', true),
    (12, 'Three Stone Accent',       'a center stone flanked by two smaller accent stones, timeless trilogy composition', true),
    (13, 'Infinity Twist',           'an infinity-symbol twist integrated into the band near the setting', false),
    (14, 'Hidden Halo',              'a discreet halo tucked beneath the center stone, visible only from the side profile', true),
    (15, 'Baguette Frame',           'slim baguette-cut accent stones framing the center stone on either side', true),
    (16, 'Minimalist Bar',           'an ultra-thin bar-set band, understated and modern, negative space emphasized', false),
    (17, 'Nature Leaf',              'organic leaf-shaped setting details, nature-inspired asymmetry', false),
    (18, 'Double Row Shank',         'a double parallel row band converging at the setting, layered look', true),
    (19, 'Antique Filigree',         'intricate antique filigree metalwork surrounding the setting', false),
    (20, 'Sunburst Halo',            'a sunburst-pattern halo with rays extending outward from the center stone', true),
    (21, 'Knife Edge Band',          'a knife-edge band profile, sharp modern line meeting a classic prong setting', false),
    (22, 'Cluster Illusion',         'small diamonds clustered to create an illusion of a larger center stone', true),
    (23, 'Textured Hammered',        'a hand-hammered textured metal finish contrasting a polished setting', false),
    (24, 'Statement Bold',           'a bold oversized statement setting, dramatic proportions, high-fashion editorial feel', true),
    (25, 'Serene Minimal',           'the most restrained possible setting, quiet luxury, barely-there metalwork', false)
),
categories(category, noun, setting_phrase) AS (
  VALUES
    ('ring',    'ring',    'set on a ring band, shown as a finished ring product photo'),
    ('pendant', 'pendant', 'set as a pendant on a fine chain, shown as a finished pendant product photo'),
    ('earring', 'earring', 'set as a matching pair of earrings, shown as a finished earring product photo')
)
INSERT INTO public.solitaire_designs (category, design_number, name, concept_prompt, has_side_diamonds)
SELECT
  c.category,
  s.design_number,
  s.style_name || ' ' || initcap(c.noun),
  s.style_prompt || ', ' || c.setting_phrase,
  s.side_diamonds
FROM styles s
CROSS JOIN categories c
ON CONFLICT DO NOTHING;
