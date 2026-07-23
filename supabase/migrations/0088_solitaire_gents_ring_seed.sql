-- Seed 25 gents' solitaire ring design concepts — distinct from the ladies'
-- ring styles (0085): wider bands, bolder/more geometric settings, brushed
-- or matte finishes, masculine styling cues.

INSERT INTO public.solitaire_designs (category, design_number, name, concept_prompt, has_side_diamonds)
VALUES
  ('gents_ring', 1,  'Signet Solitaire Gents Ring',        'a wide flat-top signet-style band with a single bezel-set center stone, bold and understated, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 2,  'Brushed Matte Gents Ring',            'a broad brushed matte-finish band with a low-profile flush-set center stone, industrial minimal, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 3,  'Black Rhodium Accent Gents Ring',      'a polished band with black rhodium-finished channel accents flanking the center stone, dramatic contrast, set on a gents ring band, shown as a finished ring product photo', true),
  ('gents_ring', 4,  'Beveled Edge Gents Ring',              'a thick band with sharp beveled edges meeting a sturdy prong setting, architectural and masculine, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 5,  'Hexagonal Bezel Gents Ring',           'a hexagonal bezel setting on a wide flat band, geometric and modern, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 6,  'Twin Groove Gents Ring',               'two parallel engraved grooves running the length of a wide band, leading into a low-set center stone, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 7,  'Onyx Inlay Gents Ring',                'a black onyx inlay strip along the band shoulders framing the center stone, bold contrast, set on a gents ring band, shown as a finished ring product photo', true),
  ('gents_ring', 8,  'Domed Comfort Gents Ring',             'a smooth domed comfort-fit band with a compact bezel-set center stone, understated everyday-wear feel, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 9,  'Stepped Edge Gents Ring',              'stepped/tiered edges along a wide band, art-deco masculine geometry, set on a gents ring band, shown as a finished ring product photo', true),
  ('gents_ring', 10, 'Hammered Texture Gents Ring',          'a hand-hammered textured band finish contrasting a polished bezel setting, rugged luxury, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 11, 'Channel Set Shoulder Gents Ring',      'a plain center bezel with a channel-set diamond trail along both shoulders, set on a gents ring band, shown as a finished ring product photo', true),
  ('gents_ring', 12, 'Split Level Gents Ring',               'a split-level band that separates and reunites around a raised center stone, dynamic silhouette, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 13, 'Two-Tone Gents Ring',                  'a two-tone metal band (contrasting inner and outer finish) with a centered bezel-set stone, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 14, 'Milgrain Border Gents Ring',           'a subtle milgrain border tracing the edge of a wide flat band, vintage-masculine detail, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 15, 'Cross Hatch Texture Gents Ring',       'a fine cross-hatch engraved texture across the band surface, tactile and modern, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 16, 'Cathedral Bold Gents Ring',            'cathedral-style shoulders in an oversized bold profile rising to the center stone, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 17, 'Tension Set Gents Ring',               'a tension-set center stone appearing to float between two solid metal arms, minimalist and striking, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 18, 'Pave Edge Gents Ring',                 'a slim pave diamond edge lining one side of an otherwise plain wide band, set on a gents ring band, shown as a finished ring product photo', true),
  ('gents_ring', 19, 'Square Bezel Gents Ring',              'a squared bezel setting with sharp corners on a matte band, bold geometric statement, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 20, 'Knurled Band Gents Ring',              'a fine knurled/ribbed texture around the full band circumference, mechanical-inspired, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 21, 'Raised Halo Gents Ring',               'a compact raised halo of small diamonds around the center stone, still restrained for masculine wear, set on a gents ring band, shown as a finished ring product photo', true),
  ('gents_ring', 22, 'Flat Top Wide Band Gents Ring',        'an extra-wide flat-top band with a discreet flush-set stone, ultra-minimal, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 23, 'Sculpted Shoulder Gents Ring',         'sculpted asymmetric shoulders flowing into a bold center setting, contemporary editorial feel, set on a gents ring band, shown as a finished ring product photo', false),
  ('gents_ring', 24, 'Statement Gunmetal Gents Ring',        'a gunmetal-tone finished band with an oversized statement bezel setting, dramatic proportions, set on a gents ring band, shown as a finished ring product photo', true),
  ('gents_ring', 25, 'Classic Gents Solitaire',              'the most restrained possible gents setting — a simple polished wide band with a modest prong-set center stone, timeless and quiet, set on a gents ring band, shown as a finished ring product photo', false)
ON CONFLICT DO NOTHING;
