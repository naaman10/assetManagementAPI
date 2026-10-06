CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE "asset_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"classification_type" varchar(30) DEFAULT 'asset' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_types_classification_type_check" CHECK ("asset_types"."classification_type" IN ('group', 'system', 'element', 'asset', 'component'))
);
--> statement-breakpoint
ALTER TABLE "asset_types" ADD CONSTRAINT "asset_types_parent_id_asset_types_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."asset_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_types_code_unique" ON "asset_types" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_asset_types_parent" ON "asset_types" USING btree ("parent_id");
--> statement-breakpoint
INSERT INTO "asset_types" ("code", "name", "classification_type")
VALUES
    ('BF',   'Building Fabric',             'group'),
    ('SAN',  'Sanitary & Plumbing',         'group'),
    ('MEC',  'Mechanical',                  'group'),
    ('ELEC', 'Electrical',                  'group'),
    ('FIRE', 'Fire Safety',                 'group'),
    ('SEC',  'Security',                    'group'),
    ('ICT',  'ICT & Communications',        'group'),
    ('CTRL', 'Building Controls',            'group'),
    ('VT',   'Vertical Transportation',      'group'),
    ('EXT',  'External Areas',              'group'),
    ('REN',  'Renewable Energy',            'group'),
    ('SPEC', 'Specialist Equipment',         'group'),
    ('HER',  'Heritage Assets',              'group'),
    ('HAZ',  'Hazardous Materials',          'group')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'BF-STR', 'Structure', 'system' FROM "asset_types" WHERE "code" = 'BF'
UNION ALL SELECT "id", 'BF-ROOF', 'Roofs', 'system' FROM "asset_types" WHERE "code" = 'BF'
UNION ALL SELECT "id", 'BF-EW', 'External Walls', 'system' FROM "asset_types" WHERE "code" = 'BF'
UNION ALL SELECT "id", 'BF-WIN', 'Windows & Glazing', 'system' FROM "asset_types" WHERE "code" = 'BF'
UNION ALL SELECT "id", 'BF-DOOR', 'Doors & Openings', 'system' FROM "asset_types" WHERE "code" = 'BF'
UNION ALL SELECT "id", 'BF-INT', 'Internal Fabric', 'system' FROM "asset_types" WHERE "code" = 'BF'
UNION ALL SELECT "id", 'BF-FIN', 'Finishes', 'system' FROM "asset_types" WHERE "code" = 'BF'
UNION ALL SELECT "id", 'BF-STAIR', 'Stairs & Access', 'system' FROM "asset_types" WHERE "code" = 'BF'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'SAN-FIX', 'Sanitary Fixtures', 'system' FROM "asset_types" WHERE "code" = 'SAN'
UNION ALL SELECT "id", 'MEC-WATER', 'Water Services', 'system' FROM "asset_types" WHERE "code" = 'MEC'
UNION ALL SELECT "id", 'MEC-DRAIN', 'Drainage', 'system' FROM "asset_types" WHERE "code" = 'MEC'
UNION ALL SELECT "id", 'MEC-HEAT', 'Heating', 'system' FROM "asset_types" WHERE "code" = 'MEC'
UNION ALL SELECT "id", 'MEC-HVAC', 'Ventilation & Air Conditioning', 'system' FROM "asset_types" WHERE "code" = 'MEC'
UNION ALL SELECT "id", 'MEC-GAS', 'Gas', 'system' FROM "asset_types" WHERE "code" = 'MEC'
UNION ALL SELECT "id", 'MEC-PRESS', 'Pressure Systems', 'system' FROM "asset_types" WHERE "code" = 'MEC'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'ELEC-SUP', 'Electrical Supply', 'system' FROM "asset_types" WHERE "code" = 'ELEC'
UNION ALL SELECT "id", 'ELEC-DIST', 'Electrical Distribution', 'system' FROM "asset_types" WHERE "code" = 'ELEC'
UNION ALL SELECT "id", 'ELEC-LIGHT', 'Lighting', 'system' FROM "asset_types" WHERE "code" = 'ELEC'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'FIRE-ALARM', 'Fire Detection & Alarm', 'system' FROM "asset_types" WHERE "code" = 'FIRE'
UNION ALL SELECT "id", 'FIRE-ACTIVE', 'Active Fire Protection', 'system' FROM "asset_types" WHERE "code" = 'FIRE'
UNION ALL SELECT "id", 'FIRE-PASSIVE', 'Passive Fire Protection', 'system' FROM "asset_types" WHERE "code" = 'FIRE'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'BF-STR-FOUND', 'Foundation', 'element' FROM "asset_types" WHERE "code" = 'BF-STR'
UNION ALL SELECT "id", 'BF-STR-FRAME', 'Structural Frame', 'element' FROM "asset_types" WHERE "code" = 'BF-STR'
UNION ALL SELECT "id", 'BF-STR-COL', 'Column', 'element' FROM "asset_types" WHERE "code" = 'BF-STR'
UNION ALL SELECT "id", 'BF-STR-BEAM', 'Beam', 'element' FROM "asset_types" WHERE "code" = 'BF-STR'
UNION ALL SELECT "id", 'BF-STR-LBW', 'Load-Bearing Wall', 'element' FROM "asset_types" WHERE "code" = 'BF-STR'
UNION ALL SELECT "id", 'BF-STR-RET', 'Retaining Wall', 'element' FROM "asset_types" WHERE "code" = 'BF-STR'
UNION ALL SELECT "id", 'BF-STR-FLOOR', 'Floor Structure', 'element' FROM "asset_types" WHERE "code" = 'BF-STR'
UNION ALL SELECT "id", 'BF-STR-ROOF', 'Roof Structure', 'element' FROM "asset_types" WHERE "code" = 'BF-STR'
UNION ALL SELECT "id", 'BF-STR-BALC', 'Balcony', 'element' FROM "asset_types" WHERE "code" = 'BF-STR'
UNION ALL SELECT "id", 'BF-STR-CAN', 'Canopy', 'element' FROM "asset_types" WHERE "code" = 'BF-STR'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'BF-ROOF-PITCH', 'Pitched Roof', 'element' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-FLAT', 'Flat Roof', 'element' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-SLATE', 'Slate Roof Covering', 'component' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-TILE', 'Tile Roof Covering', 'component' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-METAL', 'Metal Roof Covering', 'component' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-MEM', 'Membrane Roof Covering', 'component' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-GREEN', 'Green Roof', 'element' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-LIGHT', 'Rooflight', 'asset' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-FLASH', 'Flashing', 'component' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-PARA', 'Parapet', 'element' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-FASCIA', 'Fascia', 'component' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-SOFFIT', 'Soffit', 'component' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-GUTTER', 'Gutter', 'asset' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-DOWN', 'Downpipe', 'asset' FROM "asset_types" WHERE "code" = 'BF-ROOF'
UNION ALL SELECT "id", 'BF-ROOF-HOPPER', 'Hopper', 'asset' FROM "asset_types" WHERE "code" = 'BF-ROOF'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'BF-EW-BRICK', 'Brickwork', 'element' FROM "asset_types" WHERE "code" = 'BF-EW'
UNION ALL SELECT "id", 'BF-EW-BLOCK', 'Blockwork', 'element' FROM "asset_types" WHERE "code" = 'BF-EW'
UNION ALL SELECT "id", 'BF-EW-STONE', 'Stonework', 'element' FROM "asset_types" WHERE "code" = 'BF-EW'
UNION ALL SELECT "id", 'BF-EW-CLAD', 'Cladding', 'element' FROM "asset_types" WHERE "code" = 'BF-EW'
UNION ALL SELECT "id", 'BF-EW-RENDER', 'Render', 'component' FROM "asset_types" WHERE "code" = 'BF-EW'
UNION ALL SELECT "id", 'BF-EW-CURTAIN', 'Curtain Walling', 'element' FROM "asset_types" WHERE "code" = 'BF-EW'
UNION ALL SELECT "id", 'BF-EW-INSUL', 'External Insulation', 'component' FROM "asset_types" WHERE "code" = 'BF-EW'
UNION ALL SELECT "id", 'BF-EW-EXP', 'Expansion Joint', 'component' FROM "asset_types" WHERE "code" = 'BF-EW'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'BF-WIN-WINDOW', 'Window', 'asset' FROM "asset_types" WHERE "code" = 'BF-WIN'
UNION ALL SELECT "id", 'BF-WIN-SASH', 'Sash Window', 'asset' FROM "asset_types" WHERE "code" = 'BF-WIN'
UNION ALL SELECT "id", 'BF-WIN-CASE', 'Casement Window', 'asset' FROM "asset_types" WHERE "code" = 'BF-WIN'
UNION ALL SELECT "id", 'BF-WIN-ROOF', 'Roof Window', 'asset' FROM "asset_types" WHERE "code" = 'BF-WIN'
UNION ALL SELECT "id", 'BF-WIN-FIXED', 'Fixed Glazing', 'element' FROM "asset_types" WHERE "code" = 'BF-WIN'
UNION ALL SELECT "id", 'BF-WIN-LOUVRE', 'Louvre', 'asset' FROM "asset_types" WHERE "code" = 'BF-WIN'
UNION ALL SELECT "id", 'BF-WIN-REST', 'Window Restrictor', 'component' FROM "asset_types" WHERE "code" = 'BF-WIN'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'BF-DOOR-EXT', 'External Door', 'asset' FROM "asset_types" WHERE "code" = 'BF-DOOR'
UNION ALL SELECT "id", 'BF-DOOR-INT', 'Internal Door', 'asset' FROM "asset_types" WHERE "code" = 'BF-DOOR'
UNION ALL SELECT "id", 'BF-DOOR-FIRE', 'Fire Door', 'asset' FROM "asset_types" WHERE "code" = 'BF-DOOR'
UNION ALL SELECT "id", 'BF-DOOR-SEC', 'Security Door', 'asset' FROM "asset_types" WHERE "code" = 'BF-DOOR'
UNION ALL SELECT "id", 'BF-DOOR-AUTO', 'Automatic Door', 'asset' FROM "asset_types" WHERE "code" = 'BF-DOOR'
UNION ALL SELECT "id", 'BF-DOOR-ROLLER', 'Roller Shutter', 'asset' FROM "asset_types" WHERE "code" = 'BF-DOOR'
UNION ALL SELECT "id", 'BF-DOOR-LOAD', 'Loading Bay Door', 'asset' FROM "asset_types" WHERE "code" = 'BF-DOOR'
UNION ALL SELECT "id", 'BF-DOOR-HATCH', 'Access Hatch', 'asset' FROM "asset_types" WHERE "code" = 'BF-DOOR'
UNION ALL SELECT "id", 'BF-DOOR-GATE', 'Gate', 'asset' FROM "asset_types" WHERE "code" = 'BF-DOOR'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'BF-INT-PART', 'Partition Wall', 'element' FROM "asset_types" WHERE "code" = 'BF-INT'
UNION ALL SELECT "id", 'BF-INT-WALL', 'Internal Wall', 'element' FROM "asset_types" WHERE "code" = 'BF-INT'
UNION ALL SELECT "id", 'BF-INT-LINE', 'Wall Lining', 'component' FROM "asset_types" WHERE "code" = 'BF-INT'
UNION ALL SELECT "id", 'BF-INT-SUSC', 'Suspended Ceiling', 'element' FROM "asset_types" WHERE "code" = 'BF-INT'
UNION ALL SELECT "id", 'BF-INT-PLASC', 'Plaster Ceiling', 'element' FROM "asset_types" WHERE "code" = 'BF-INT'
UNION ALL SELECT "id", 'BF-INT-FLOOR', 'Floor', 'element' FROM "asset_types" WHERE "code" = 'BF-INT'
UNION ALL SELECT "id", 'BF-INT-RAISED', 'Raised Floor', 'element' FROM "asset_types" WHERE "code" = 'BF-INT'
UNION ALL SELECT "id", 'BF-INT-SKIRT', 'Skirting', 'component' FROM "asset_types" WHERE "code" = 'BF-INT'
UNION ALL SELECT "id", 'BF-INT-ARCH', 'Architrave', 'component' FROM "asset_types" WHERE "code" = 'BF-INT'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'BF-FIN-WALL', 'Wall Finish', 'component' FROM "asset_types" WHERE "code" = 'BF-FIN'
UNION ALL SELECT "id", 'BF-FIN-PAINT', 'Paint / Decoration', 'component' FROM "asset_types" WHERE "code" = 'BF-FIN'
UNION ALL SELECT "id", 'BF-FIN-WALLP', 'Wallpaper', 'component' FROM "asset_types" WHERE "code" = 'BF-FIN'
UNION ALL SELECT "id", 'BF-FIN-TILE', 'Tiling', 'component' FROM "asset_types" WHERE "code" = 'BF-FIN'
UNION ALL SELECT "id", 'BF-FIN-FLOOR', 'Floor Covering', 'component' FROM "asset_types" WHERE "code" = 'BF-FIN'
UNION ALL SELECT "id", 'BF-FIN-CARPET', 'Carpet', 'component' FROM "asset_types" WHERE "code" = 'BF-FIN'
UNION ALL SELECT "id", 'BF-FIN-VINYL', 'Vinyl Flooring', 'component' FROM "asset_types" WHERE "code" = 'BF-FIN'
UNION ALL SELECT "id", 'BF-FIN-RESIN', 'Resin Flooring', 'component' FROM "asset_types" WHERE "code" = 'BF-FIN'
UNION ALL SELECT "id", 'BF-FIN-CEIL', 'Ceiling Finish', 'component' FROM "asset_types" WHERE "code" = 'BF-FIN'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'BF-STAIR-STAIR', 'Staircase', 'element' FROM "asset_types" WHERE "code" = 'BF-STAIR'
UNION ALL SELECT "id", 'BF-STAIR-STEP', 'Steps', 'element' FROM "asset_types" WHERE "code" = 'BF-STAIR'
UNION ALL SELECT "id", 'BF-STAIR-RAMP', 'Ramp', 'element' FROM "asset_types" WHERE "code" = 'BF-STAIR'
UNION ALL SELECT "id", 'BF-STAIR-HAND', 'Handrail', 'asset' FROM "asset_types" WHERE "code" = 'BF-STAIR'
UNION ALL SELECT "id", 'BF-STAIR-BAL', 'Balustrade', 'asset' FROM "asset_types" WHERE "code" = 'BF-STAIR'
UNION ALL SELECT "id", 'BF-STAIR-LAD', 'Ladder', 'asset' FROM "asset_types" WHERE "code" = 'BF-STAIR'
UNION ALL SELECT "id", 'BF-STAIR-WALK', 'Walkway', 'element' FROM "asset_types" WHERE "code" = 'BF-STAIR'
UNION ALL SELECT "id", 'BF-STAIR-PLAT', 'Platform', 'element' FROM "asset_types" WHERE "code" = 'BF-STAIR'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'SAN-WC', 'WC', 'asset' FROM "asset_types" WHERE "code" = 'SAN-FIX'
UNION ALL SELECT "id", 'SAN-URINAL', 'Urinal', 'asset' FROM "asset_types" WHERE "code" = 'SAN-FIX'
UNION ALL SELECT "id", 'SAN-BASIN', 'Wash Basin', 'asset' FROM "asset_types" WHERE "code" = 'SAN-FIX'
UNION ALL SELECT "id", 'SAN-SINK', 'Sink', 'asset' FROM "asset_types" WHERE "code" = 'SAN-FIX'
UNION ALL SELECT "id", 'SAN-BATH', 'Bath', 'asset' FROM "asset_types" WHERE "code" = 'SAN-FIX'
UNION ALL SELECT "id", 'SAN-SHOWER', 'Shower', 'asset' FROM "asset_types" WHERE "code" = 'SAN-FIX'
UNION ALL SELECT "id", 'SAN-TAP', 'Tap', 'asset' FROM "asset_types" WHERE "code" = 'SAN-FIX'
UNION ALL SELECT "id", 'SAN-DRINK', 'Drinking Fountain', 'asset' FROM "asset_types" WHERE "code" = 'SAN-FIX'
UNION ALL SELECT "id", 'SAN-SLUICE', 'Sluice', 'asset' FROM "asset_types" WHERE "code" = 'SAN-FIX'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'MEC-WATER-COLD', 'Cold Water Tank', 'asset' FROM "asset_types" WHERE "code" = 'MEC-WATER'
UNION ALL SELECT "id", 'MEC-WATER-HOT', 'Hot Water Cylinder', 'asset' FROM "asset_types" WHERE "code" = 'MEC-WATER'
UNION ALL SELECT "id", 'MEC-WATER-CAL', 'Calorifier', 'asset' FROM "asset_types" WHERE "code" = 'MEC-WATER'
UNION ALL SELECT "id", 'MEC-WATER-HEATER', 'Water Heater', 'asset' FROM "asset_types" WHERE "code" = 'MEC-WATER'
UNION ALL SELECT "id", 'MEC-WATER-PUMP', 'Water Pump', 'asset' FROM "asset_types" WHERE "code" = 'MEC-WATER'
UNION ALL SELECT "id", 'MEC-WATER-BOOST', 'Booster Set', 'asset' FROM "asset_types" WHERE "code" = 'MEC-WATER'
UNION ALL SELECT "id", 'MEC-WATER-PIPE', 'Water Pipework', 'element' FROM "asset_types" WHERE "code" = 'MEC-WATER'
UNION ALL SELECT "id", 'MEC-WATER-VALVE', 'Valve', 'asset' FROM "asset_types" WHERE "code" = 'MEC-WATER'
UNION ALL SELECT "id", 'MEC-WATER-BACK', 'Backflow Preventer', 'asset' FROM "asset_types" WHERE "code" = 'MEC-WATER'
UNION ALL SELECT "id", 'MEC-WATER-METER', 'Water Meter', 'asset' FROM "asset_types" WHERE "code" = 'MEC-WATER'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'MEC-DRAIN-SOIL', 'Soil Stack', 'element' FROM "asset_types" WHERE "code" = 'MEC-DRAIN'
UNION ALL SELECT "id", 'MEC-DRAIN-WASTE', 'Waste Pipe', 'element' FROM "asset_types" WHERE "code" = 'MEC-DRAIN'
UNION ALL SELECT "id", 'MEC-DRAIN-DRAIN', 'Drain', 'element' FROM "asset_types" WHERE "code" = 'MEC-DRAIN'
UNION ALL SELECT "id", 'MEC-DRAIN-MAN', 'Manhole', 'asset' FROM "asset_types" WHERE "code" = 'MEC-DRAIN'
UNION ALL SELECT "id", 'MEC-DRAIN-CHAM', 'Inspection Chamber', 'asset' FROM "asset_types" WHERE "code" = 'MEC-DRAIN'
UNION ALL SELECT "id", 'MEC-DRAIN-GULLY', 'Gully', 'asset' FROM "asset_types" WHERE "code" = 'MEC-DRAIN'
UNION ALL SELECT "id", 'MEC-DRAIN-GREASE', 'Grease Trap', 'asset' FROM "asset_types" WHERE "code" = 'MEC-DRAIN'
UNION ALL SELECT "id", 'MEC-DRAIN-SUMP', 'Sump', 'asset' FROM "asset_types" WHERE "code" = 'MEC-DRAIN'
UNION ALL SELECT "id", 'MEC-DRAIN-PUMP', 'Sewage Pump', 'asset' FROM "asset_types" WHERE "code" = 'MEC-DRAIN'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'MEC-HEAT-BOILER', 'Boiler', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HEAT'
UNION ALL SELECT "id", 'MEC-HEAT-HP', 'Heat Pump', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HEAT'
UNION ALL SELECT "id", 'MEC-HEAT-RAD', 'Radiator', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HEAT'
UNION ALL SELECT "id", 'MEC-HEAT-CONV', 'Convector', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HEAT'
UNION ALL SELECT "id", 'MEC-HEAT-TRENCH', 'Trench Heater', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HEAT'
UNION ALL SELECT "id", 'MEC-HEAT-UFH', 'Underfloor Heating', 'system' FROM "asset_types" WHERE "code" = 'MEC-HEAT'
UNION ALL SELECT "id", 'MEC-HEAT-PUMP', 'Heating Pump', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HEAT'
UNION ALL SELECT "id", 'MEC-HEAT-EXP', 'Expansion Vessel', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HEAT'
UNION ALL SELECT "id", 'MEC-HEAT-HX', 'Heat Exchanger', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HEAT'
UNION ALL SELECT "id", 'MEC-HEAT-PRESS', 'Pressurisation Unit', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HEAT'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'MEC-HVAC-AHU', 'Air Handling Unit', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HVAC'
UNION ALL SELECT "id", 'MEC-HVAC-FCU', 'Fan Coil Unit', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HVAC'
UNION ALL SELECT "id", 'MEC-HVAC-AC', 'Air Conditioning Unit', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HVAC'
UNION ALL SELECT "id", 'MEC-HVAC-VRF', 'VRF / VRV Unit', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HVAC'
UNION ALL SELECT "id", 'MEC-HVAC-CHILL', 'Chiller', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HVAC'
UNION ALL SELECT "id", 'MEC-HVAC-COOL', 'Cooling Tower', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HVAC'
UNION ALL SELECT "id", 'MEC-HVAC-EXFAN', 'Extract Fan', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HVAC'
UNION ALL SELECT "id", 'MEC-HVAC-SFAN', 'Supply Fan', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HVAC'
UNION ALL SELECT "id", 'MEC-HVAC-DUCT', 'Ductwork', 'element' FROM "asset_types" WHERE "code" = 'MEC-HVAC'
UNION ALL SELECT "id", 'MEC-HVAC-DAMP', 'Damper', 'asset' FROM "asset_types" WHERE "code" = 'MEC-HVAC'
UNION ALL SELECT "id", 'MEC-HVAC-GRILLE', 'Grille', 'component' FROM "asset_types" WHERE "code" = 'MEC-HVAC'
UNION ALL SELECT "id", 'MEC-HVAC-DIFF', 'Diffuser', 'component' FROM "asset_types" WHERE "code" = 'MEC-HVAC'
UNION ALL SELECT "id", 'MEC-HVAC-FILTER', 'Air Filter', 'component' FROM "asset_types" WHERE "code" = 'MEC-HVAC'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'MEC-GAS-METER', 'Gas Meter', 'asset' FROM "asset_types" WHERE "code" = 'MEC-GAS'
UNION ALL SELECT "id", 'MEC-GAS-PIPE', 'Gas Pipework', 'element' FROM "asset_types" WHERE "code" = 'MEC-GAS'
UNION ALL SELECT "id", 'MEC-GAS-VALVE', 'Gas Valve', 'asset' FROM "asset_types" WHERE "code" = 'MEC-GAS'
UNION ALL SELECT "id", 'MEC-GAS-DETECT', 'Gas Detector', 'asset' FROM "asset_types" WHERE "code" = 'MEC-GAS'
UNION ALL SELECT "id", 'MEC-GAS-REG', 'Gas Regulator', 'asset' FROM "asset_types" WHERE "code" = 'MEC-GAS'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'MEC-PRESS-COMP', 'Air Compressor', 'asset' FROM "asset_types" WHERE "code" = 'MEC-PRESS'
UNION ALL SELECT "id", 'MEC-PRESS-RECV', 'Compressed Air Receiver', 'asset' FROM "asset_types" WHERE "code" = 'MEC-PRESS'
UNION ALL SELECT "id", 'MEC-PRESS-VESSEL', 'Pressure Vessel', 'asset' FROM "asset_types" WHERE "code" = 'MEC-PRESS'
UNION ALL SELECT "id", 'MEC-PRESS-VAC', 'Vacuum Pump', 'asset' FROM "asset_types" WHERE "code" = 'MEC-PRESS'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'ELEC-SUP-TRANS', 'Transformer', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-SUP'
UNION ALL SELECT "id", 'ELEC-SUP-SWITCH', 'Switchgear', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-SUP'
UNION ALL SELECT "id", 'ELEC-SUP-LV', 'LV Panel', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-SUP'
UNION ALL SELECT "id", 'ELEC-SUP-DB', 'Distribution Board', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-SUP'
UNION ALL SELECT "id", 'ELEC-SUP-CU', 'Consumer Unit', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-SUP'
UNION ALL SELECT "id", 'ELEC-SUP-ISO', 'Isolator', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-SUP'
UNION ALL SELECT "id", 'ELEC-SUP-UPS', 'UPS', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-SUP'
UNION ALL SELECT "id", 'ELEC-SUP-GEN', 'Generator', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-SUP'
UNION ALL SELECT "id", 'ELEC-SUP-ATS', 'Automatic Transfer Switch', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-SUP'
UNION ALL SELECT "id", 'ELEC-SUP-CAP', 'Capacitor Bank', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-SUP'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'ELEC-DIST-CABLE', 'Electrical Cable', 'element' FROM "asset_types" WHERE "code" = 'ELEC-DIST'
UNION ALL SELECT "id", 'ELEC-DIST-TRAY', 'Cable Tray', 'element' FROM "asset_types" WHERE "code" = 'ELEC-DIST'
UNION ALL SELECT "id", 'ELEC-DIST-BUS', 'Busbar', 'element' FROM "asset_types" WHERE "code" = 'ELEC-DIST'
UNION ALL SELECT "id", 'ELEC-DIST-SOCK', 'Socket Outlet', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-DIST'
UNION ALL SELECT "id", 'ELEC-DIST-SPUR', 'Fused Spur', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-DIST'
UNION ALL SELECT "id", 'ELEC-DIST-FLOOR', 'Floor Box', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-DIST'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'ELEC-LIGHT-INT', 'Internal Luminaire', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-LIGHT'
UNION ALL SELECT "id", 'ELEC-LIGHT-EXT', 'External Luminaire', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-LIGHT'
UNION ALL SELECT "id", 'ELEC-LIGHT-EM', 'Emergency Light', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-LIGHT'
UNION ALL SELECT "id", 'ELEC-LIGHT-EXIT', 'Exit Sign', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-LIGHT'
UNION ALL SELECT "id", 'ELEC-LIGHT-CTRL', 'Lighting Control', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-LIGHT'
UNION ALL SELECT "id", 'ELEC-LIGHT-OCC', 'Occupancy Sensor', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-LIGHT'
UNION ALL SELECT "id", 'ELEC-LIGHT-PHOTO', 'Photocell', 'asset' FROM "asset_types" WHERE "code" = 'ELEC-LIGHT'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'CTRL-BMS', 'BMS Controller', 'asset' FROM "asset_types" WHERE "code" = 'CTRL'
UNION ALL SELECT "id", 'CTRL-SENSOR', 'Sensor', 'asset' FROM "asset_types" WHERE "code" = 'CTRL'
UNION ALL SELECT "id", 'CTRL-THERM', 'Thermostat', 'asset' FROM "asset_types" WHERE "code" = 'CTRL'
UNION ALL SELECT "id", 'CTRL-ACT', 'Actuator', 'asset' FROM "asset_types" WHERE "code" = 'CTRL'
UNION ALL SELECT "id", 'CTRL-PANEL', 'Control Panel', 'asset' FROM "asset_types" WHERE "code" = 'CTRL'
UNION ALL SELECT "id", 'CTRL-METER', 'Smart Meter', 'asset' FROM "asset_types" WHERE "code" = 'CTRL'
UNION ALL SELECT "id", 'CTRL-ENV', 'Environmental Sensor', 'asset' FROM "asset_types" WHERE "code" = 'CTRL'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'REN-PV', 'Solar PV Panel', 'asset' FROM "asset_types" WHERE "code" = 'REN'
UNION ALL SELECT "id", 'REN-INV', 'Solar Inverter', 'asset' FROM "asset_types" WHERE "code" = 'REN'
UNION ALL SELECT "id", 'REN-BATT', 'Battery Storage', 'asset' FROM "asset_types" WHERE "code" = 'REN'
UNION ALL SELECT "id", 'REN-THERM', 'Solar Thermal Collector', 'asset' FROM "asset_types" WHERE "code" = 'REN'
UNION ALL SELECT "id", 'REN-WIND', 'Wind Turbine', 'asset' FROM "asset_types" WHERE "code" = 'REN'
UNION ALL SELECT "id", 'REN-EV', 'EV Charger', 'asset' FROM "asset_types" WHERE "code" = 'REN'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'FIRE-ALARM-PANEL', 'Fire Alarm Panel', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-ALARM'
UNION ALL SELECT "id", 'FIRE-ALARM-SMOKE', 'Smoke Detector', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-ALARM'
UNION ALL SELECT "id", 'FIRE-ALARM-HEAT', 'Heat Detector', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-ALARM'
UNION ALL SELECT "id", 'FIRE-ALARM-MULTI', 'Multisensor Detector', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-ALARM'
UNION ALL SELECT "id", 'FIRE-ALARM-MCP', 'Manual Call Point', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-ALARM'
UNION ALL SELECT "id", 'FIRE-ALARM-SOUND', 'Sounder', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-ALARM'
UNION ALL SELECT "id", 'FIRE-ALARM-BEACON', 'Beacon', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-ALARM'
UNION ALL SELECT "id", 'FIRE-ALARM-ASD', 'Aspirating Smoke Detector', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-ALARM'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'FIRE-ACT-SPRINK', 'Sprinkler Head', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-ACTIVE'
UNION ALL SELECT "id", 'FIRE-ACT-SPRSYS', 'Sprinkler System', 'system' FROM "asset_types" WHERE "code" = 'FIRE-ACTIVE'
UNION ALL SELECT "id", 'FIRE-ACT-SPRPUMP', 'Sprinkler Pump', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-ACTIVE'
UNION ALL SELECT "id", 'FIRE-ACT-RISER', 'Wet / Dry Riser', 'system' FROM "asset_types" WHERE "code" = 'FIRE-ACTIVE'
UNION ALL SELECT "id", 'FIRE-ACT-EXT', 'Fire Extinguisher', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-ACTIVE'
UNION ALL SELECT "id", 'FIRE-ACT-BLANK', 'Fire Blanket', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-ACTIVE'
UNION ALL SELECT "id", 'FIRE-ACT-HOSE', 'Hose Reel', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-ACTIVE'
UNION ALL SELECT "id", 'FIRE-ACT-SUPP', 'Fire Suppression System', 'system' FROM "asset_types" WHERE "code" = 'FIRE-ACTIVE'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'FIRE-PAS-DOOR', 'Fire Door', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-PASSIVE'
UNION ALL SELECT "id", 'FIRE-PAS-SHUT', 'Fire Shutter', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-PASSIVE'
UNION ALL SELECT "id", 'FIRE-PAS-DAMP', 'Fire Damper', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-PASSIVE'
UNION ALL SELECT "id", 'FIRE-PAS-SMOKE', 'Smoke Damper', 'asset' FROM "asset_types" WHERE "code" = 'FIRE-PASSIVE'
UNION ALL SELECT "id", 'FIRE-PAS-STOP', 'Fire Stopping', 'element' FROM "asset_types" WHERE "code" = 'FIRE-PASSIVE'
UNION ALL SELECT "id", 'FIRE-PAS-COMP', 'Compartment Wall', 'element' FROM "asset_types" WHERE "code" = 'FIRE-PASSIVE'
UNION ALL SELECT "id", 'FIRE-PAS-GLAZ', 'Fire-Rated Glazing', 'element' FROM "asset_types" WHERE "code" = 'FIRE-PASSIVE'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'SEC-CCTV', 'CCTV Camera', 'asset' FROM "asset_types" WHERE "code" = 'SEC'
UNION ALL SELECT "id", 'SEC-NVR', 'NVR / DVR', 'asset' FROM "asset_types" WHERE "code" = 'SEC'
UNION ALL SELECT "id", 'SEC-DETECT', 'Intruder Detector', 'asset' FROM "asset_types" WHERE "code" = 'SEC'
UNION ALL SELECT "id", 'SEC-PANEL', 'Intruder Alarm Panel', 'asset' FROM "asset_types" WHERE "code" = 'SEC'
UNION ALL SELECT "id", 'SEC-PANIC', 'Panic Alarm', 'asset' FROM "asset_types" WHERE "code" = 'SEC'
UNION ALL SELECT "id", 'SEC-READER', 'Access Control Reader', 'asset' FROM "asset_types" WHERE "code" = 'SEC'
UNION ALL SELECT "id", 'SEC-DOORCTRL', 'Door Controller', 'asset' FROM "asset_types" WHERE "code" = 'SEC'
UNION ALL SELECT "id", 'SEC-INTERCOM', 'Intercom', 'asset' FROM "asset_types" WHERE "code" = 'SEC'
UNION ALL SELECT "id", 'SEC-BARRIER', 'Security Barrier', 'asset' FROM "asset_types" WHERE "code" = 'SEC'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'ICT-CAB', 'Data Cabinet', 'asset' FROM "asset_types" WHERE "code" = 'ICT'
UNION ALL SELECT "id", 'ICT-SWITCH', 'Network Switch', 'asset' FROM "asset_types" WHERE "code" = 'ICT'
UNION ALL SELECT "id", 'ICT-WAP', 'Wi-Fi Access Point', 'asset' FROM "asset_types" WHERE "code" = 'ICT'
UNION ALL SELECT "id", 'ICT-CABLE', 'Structured Cabling', 'element' FROM "asset_types" WHERE "code" = 'ICT'
UNION ALL SELECT "id", 'ICT-TEL', 'Telephone System', 'system' FROM "asset_types" WHERE "code" = 'ICT'
UNION ALL SELECT "id", 'ICT-ANT', 'Antenna', 'asset' FROM "asset_types" WHERE "code" = 'ICT'
UNION ALL SELECT "id", 'ICT-RACK', 'Communications Rack', 'asset' FROM "asset_types" WHERE "code" = 'ICT'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'VT-PASS', 'Passenger Lift', 'asset' FROM "asset_types" WHERE "code" = 'VT'
UNION ALL SELECT "id", 'VT-GOODS', 'Goods Lift', 'asset' FROM "asset_types" WHERE "code" = 'VT'
UNION ALL SELECT "id", 'VT-PLAT', 'Platform Lift', 'asset' FROM "asset_types" WHERE "code" = 'VT'
UNION ALL SELECT "id", 'VT-STAIR', 'Stairlift', 'asset' FROM "asset_types" WHERE "code" = 'VT'
UNION ALL SELECT "id", 'VT-ESC', 'Escalator', 'asset' FROM "asset_types" WHERE "code" = 'VT'
UNION ALL SELECT "id", 'VT-TRAVEL', 'Travelator', 'asset' FROM "asset_types" WHERE "code" = 'VT'
UNION ALL SELECT "id", 'VT-HOIST', 'Hoist', 'asset' FROM "asset_types" WHERE "code" = 'VT'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'EXT-ROAD', 'Road', 'element' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-CAR', 'Car Park', 'element' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-PAVE', 'Pavement', 'element' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-PATH', 'Footpath', 'element' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-KERB', 'Kerb', 'element' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-STEP', 'External Steps', 'element' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-RAMP', 'External Ramp', 'element' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-WALL', 'Boundary Wall', 'element' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-FENCE', 'Fence', 'asset' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-GATE', 'External Gate', 'asset' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-BOLL', 'Bollard', 'asset' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-TREE', 'Tree', 'asset' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-IRR', 'Irrigation System', 'system' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-BENCH', 'Bench', 'asset' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-BIN', 'Bin', 'asset' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-CYCLE', 'Cycle Rack', 'asset' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-SHELTER', 'Shelter', 'asset' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-SIGN', 'External Signage', 'asset' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-LAMP', 'Lamp Post', 'asset' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-FLOOD', 'Floodlight', 'asset' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-CHAN', 'Channel Drain', 'asset' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-SOAK', 'Soakaway', 'element' FROM "asset_types" WHERE "code" = 'EXT'
UNION ALL SELECT "id", 'EXT-ATTEN', 'Attenuation System', 'system' FROM "asset_types" WHERE "code" = 'EXT'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'SPEC-KITCH', 'Commercial Kitchen Equipment', 'asset' FROM "asset_types" WHERE "code" = 'SPEC'
UNION ALL SELECT "id", 'SPEC-LAUND', 'Laundry Equipment', 'asset' FROM "asset_types" WHERE "code" = 'SPEC'
UNION ALL SELECT "id", 'SPEC-LAB', 'Laboratory Equipment', 'asset' FROM "asset_types" WHERE "code" = 'SPEC'
UNION ALL SELECT "id", 'SPEC-WORK', 'Workshop Equipment', 'asset' FROM "asset_types" WHERE "code" = 'SPEC'
UNION ALL SELECT "id", 'SPEC-MED', 'Medical Equipment', 'asset' FROM "asset_types" WHERE "code" = 'SPEC'
UNION ALL SELECT "id", 'SPEC-POOL', 'Pool Equipment', 'asset' FROM "asset_types" WHERE "code" = 'SPEC'
UNION ALL SELECT "id", 'SPEC-CRANE', 'Crane', 'asset' FROM "asset_types" WHERE "code" = 'SPEC'
UNION ALL SELECT "id", 'SPEC-GANTRY', 'Gantry', 'asset' FROM "asset_types" WHERE "code" = 'SPEC'
UNION ALL SELECT "id", 'SPEC-LIFTPLAT', 'Lifting Platform', 'asset' FROM "asset_types" WHERE "code" = 'SPEC'
UNION ALL SELECT "id", 'SPEC-BEAM', 'Lifting Beam', 'asset' FROM "asset_types" WHERE "code" = 'SPEC'
UNION ALL SELECT "id", 'SPEC-PHOIST', 'Patient Hoist', 'asset' FROM "asset_types" WHERE "code" = 'SPEC'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'HAZ-ASB', 'Asbestos-Containing Material', 'element' FROM "asset_types" WHERE "code" = 'HAZ'
UNION ALL SELECT "id", 'HAZ-LEAD', 'Lead-Containing Material', 'element' FROM "asset_types" WHERE "code" = 'HAZ'
UNION ALL SELECT "id", 'HAZ-CHEM', 'Hazardous Chemical Storage', 'asset' FROM "asset_types" WHERE "code" = 'HAZ'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_types" ("parent_id", "code", "name", "classification_type")
SELECT "id", 'HER-WIN', 'Historic Window', 'asset' FROM "asset_types" WHERE "code" = 'HER'
UNION ALL SELECT "id", 'HER-DOOR', 'Historic Door', 'asset' FROM "asset_types" WHERE "code" = 'HER'
UNION ALL SELECT "id", 'HER-PLASTER', 'Decorative Plasterwork', 'element' FROM "asset_types" WHERE "code" = 'HER'
UNION ALL SELECT "id", 'HER-STONE', 'Stone Carving', 'element' FROM "asset_types" WHERE "code" = 'HER'
UNION ALL SELECT "id", 'HER-CORNICE', 'Historic Cornice', 'element' FROM "asset_types" WHERE "code" = 'HER'
UNION ALL SELECT "id", 'HER-FIRE', 'Historic Fireplace', 'asset' FROM "asset_types" WHERE "code" = 'HER'
UNION ALL SELECT "id", 'HER-GLASS', 'Stained Glass', 'asset' FROM "asset_types" WHERE "code" = 'HER'
UNION ALL SELECT "id", 'HER-MON', 'Monument / Statue', 'asset' FROM "asset_types" WHERE "code" = 'HER'
ON CONFLICT ("code") DO NOTHING;