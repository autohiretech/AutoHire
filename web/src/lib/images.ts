/**
 * Photo sources for listing images.
 *
 * The demo catalogue stores photos as `loremflickr.com/<w>/<h>/<keyword>?lock=<n>`
 * URLs, but we never fetch loremflickr — it is unusable as an image source. Its
 * `lock=<n>` indexes into a tag's Flickr result set, so sparse tags (`mg,car`,
 * `polestar,car`) 404 outright, and it rate-limits under any real load. Instead the
 * URL is treated purely as a *descriptor*: `<keyword>` selects a curated pool and
 * `<n>` selects a photo within it.
 *
 * The photos are subject-verified images from Wikimedia Commons (each filename names
 * the vehicle, see the comments below), served via images.weserv.nl, which resizes
 * them to a uniform 800x600 WebP and edge-caches the result. Only ~70 distinct images
 * back the whole catalogue, so after the first fetch of each, every listing card is a
 * browser/edge cache hit rather than a unique cold request.
 *
 * Wikimedia rate-limits (429) bursts of cold fetches, so the pool is pre-warmed into
 * weserv's cache once (see scripts/warm-image-cache.sh). `Img` falls back to
 * PHOTO_FALLBACK if anything still fails.
 */

/** `loremflickr.com/<w>/<h>/<keyword>?lock=<n>` — a descriptor, never fetched. */
const DESCRIPTOR = /loremflickr\.com\/\d+\/\d+\/([^?]+)\?lock=(\d+)/i;

/** Shown before anything loads and whenever an image fails — needs no network. */
export const PHOTO_FALLBACK =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">' +
      '<rect width="800" height="600" fill="#e9edf2"/>' +
      '<g fill="none" stroke="#aab4c0" stroke-width="14" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M250 372h300l-42-84a28 28 0 00-25-16H317a28 28 0 00-25 16z"/>' +
      '<circle cx="322" cy="392" r="30"/><circle cx="478" cy="392" r="30"/>' +
      '</g></svg>',
  );

/**
 * Wrap a Wikimedia host+path in the weserv CDN, normalised to 800x600 WebP.
 * The stored paths are scheme-less and already percent-encoded exactly as Commons
 * emits them, so they are passed through raw — re-encoding would double-escape
 * non-ASCII filenames (e.g. `Autofr%C3%BChling`).
 */
function cdn(hostPath: string): string {
  return `https://images.weserv.nl/?url=${hostPath}&w=800&h=600&fit=cover&output=webp&q=72`;
}

/** Curated, subject-verified photos. Keyed by car make, cabin view, or machine type. */
const POOLS = {
  toyota: [
    // Toyota RAV4 (XA10) IMG 1260.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/7/78/Toyota_RAV4_%28XA10%29_IMG_1260.jpg/960px-Toyota_RAV4_%28XA10%29_IMG_1260.jpg',
    // Toyota Land Cruiser 16.09.20 JM (3).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/9/95/Toyota_Land_Cruiser_16.09.20_JM_%283%29.jpg/960px-Toyota_Land_Cruiser_16.09.20_JM_%283%29.jpg',
    // Toyota Corolla (E180) sedan facelift 1X7A0306.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/7/76/Toyota_Corolla_%28E180%29_sedan_facelift_1X7A0306.jpg/960px-Toyota_Corolla_%28E180%29_sedan_facelift_1X7A0306.jpg',
  ],
  byd: [
    // BYD Seal U IAA 2023 1X7A0045.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/1/1f/BYD_Seal_U_IAA_2023_1X7A0045.jpg/960px-BYD_Seal_U_IAA_2023_1X7A0045.jpg',
    // BYD Seal, IAA Open Space 2023, Munich (P1120203).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/0/0d/BYD_Seal%2C_IAA_Open_Space_2023%2C_Munich_%28P1120203%29.jpg/960px-BYD_Seal%2C_IAA_Open_Space_2023%2C_Munich_%28P1120203%29.jpg',
    // BYD Atto 3 1X7A6495.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/7/78/BYD_Atto_3_1X7A6495.jpg/960px-BYD_Atto_3_1X7A6495.jpg',
    // BYD Atto 3 1X7A6494.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/1/10/BYD_Atto_3_1X7A6494.jpg/960px-BYD_Atto_3_1X7A6494.jpg',
  ],
  nissan: [
    // 2017 Nissan LEAF (ZE0 MY17) hatchback (2018-11-02) 01.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/6/62/2017_Nissan_LEAF_%28ZE0_MY17%29_hatchback_%282018-11-02%29_01.jpg/960px-2017_Nissan_LEAF_%28ZE0_MY17%29_hatchback_%282018-11-02%29_01.jpg',
    // Nissan Leaf, GIMS 2019, Le Grand-Saconnex (GIMS0734).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/c/c0/Nissan_Leaf%2C_GIMS_2019%2C_Le_Grand-Saconnex_%28GIMS0734%29.jpg/960px-Nissan_Leaf%2C_GIMS_2019%2C_Le_Grand-Saconnex_%28GIMS0734%29.jpg',
    // Nissan X-Trail (T33) 1X7A7179.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/3/35/Nissan_X-Trail_%28T33%29_1X7A7179.jpg/960px-Nissan_X-Trail_%28T33%29_1X7A7179.jpg',
    // Nissan Patrol, Ribnitz-Damgarten (P1070877).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Nissan_Patrol%2C_Ribnitz-Damgarten_%28P1070877%29.jpg/960px-Nissan_Patrol%2C_Ribnitz-Damgarten_%28P1070877%29.jpg',
  ],
  hyundai: [
    // Hyundai Ioniq 5 IAA 2021 1X7A0189.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Hyundai_Ioniq_5_IAA_2021_1X7A0189.jpg/960px-Hyundai_Ioniq_5_IAA_2021_1X7A0189.jpg',
    // Hyundai Ioniq 5 N Line IMG 3869.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Hyundai_Ioniq_5_N_Line_IMG_3869.jpg/960px-Hyundai_Ioniq_5_N_Line_IMG_3869.jpg',
    // Hyundai Ioniq 5 Robotaxi IAA 2021 1X7A0002.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/d/df/Hyundai_Ioniq_5_Robotaxi_IAA_2021_1X7A0002.jpg/960px-Hyundai_Ioniq_5_Robotaxi_IAA_2021_1X7A0002.jpg',
  ],
  kia: [
    // Kia EV6 GT IMG 8171.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Kia_EV6_GT_IMG_8171.jpg/960px-Kia_EV6_GT_IMG_8171.jpg',
    // Kia EV6 GT IMG 8180.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Kia_EV6_GT_IMG_8180.jpg/960px-Kia_EV6_GT_IMG_8180.jpg',
    // Kia EV6 Automesse Ludwigsburg 2022 1X7A5931.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/8/82/Kia_EV6_Automesse_Ludwigsburg_2022_1X7A5931.jpg/960px-Kia_EV6_Automesse_Ludwigsburg_2022_1X7A5931.jpg',
  ],
  volkswagen: [
    // Volkswagen ID.5 GTX 1X7A0318.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Volkswagen_ID.5_GTX_1X7A0318.jpg/960px-Volkswagen_ID.5_GTX_1X7A0318.jpg',
    // Volkswagen ID.4 GTX 1X7A0301.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Volkswagen_ID.4_GTX_1X7A0301.jpg/960px-Volkswagen_ID.4_GTX_1X7A0301.jpg',
    // Volkswagen ID.7 Tourer IMG 4198.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Volkswagen_ID.7_Tourer_IMG_4198.jpg/960px-Volkswagen_ID.7_Tourer_IMG_4198.jpg',
  ],
  mg: [
    // MG4 EV Automesse Ludwigsburg 2022 1X7A5920.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/4/4f/MG4_EV_Automesse_Ludwigsburg_2022_1X7A5920.jpg/960px-MG4_EV_Automesse_Ludwigsburg_2022_1X7A5920.jpg',
    // MG4 EV Automesse Ludwigsburg 2022 1X7A5873.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/0/06/MG4_EV_Automesse_Ludwigsburg_2022_1X7A5873.jpg/960px-MG4_EV_Automesse_Ludwigsburg_2022_1X7A5873.jpg',
    // MG Mulan IMG001.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/4/4c/MG_Mulan_IMG001.jpg/960px-MG_Mulan_IMG001.jpg',
  ],
  polestar: [
    // Polestar 2 BST Edition 230 Auto Zuerich 2023 1X7A1303.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Polestar_2_BST_Edition_230_Auto_Zuerich_2023_1X7A1303.jpg/960px-Polestar_2_BST_Edition_230_Auto_Zuerich_2023_1X7A1303.jpg',
    // Polestar 2 Nersingen.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Polestar_2_Nersingen.jpg/960px-Polestar_2_Nersingen.jpg',
    // Polestar 2 facelift 001.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Polestar_2_facelift_001.jpg/960px-Polestar_2_facelift_001.jpg',
  ],
  bmw: [
    // BMW i4 IAA 2021 1X7A0307.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/1/17/BMW_i4_IAA_2021_1X7A0307.jpg/960px-BMW_i4_IAA_2021_1X7A0307.jpg',
    // BMW i4 1X7A6838.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/d/d4/BMW_i4_1X7A6838.jpg/960px-BMW_i4_1X7A6838.jpg',
    // BMW i4 M50 1X7A7379.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/9/9b/BMW_i4_M50_1X7A7379.jpg/960px-BMW_i4_M50_1X7A7379.jpg',
  ],
  mercedes: [
    // MERCEDES-EQ EQB China.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/d/d5/MERCEDES-EQ_EQB_China.jpg/960px-MERCEDES-EQ_EQB_China.jpg',
    // MERCEDES-EQ EQB China (4).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/e/ec/MERCEDES-EQ_EQB_China_%284%29.jpg/960px-MERCEDES-EQ_EQB_China_%284%29.jpg',
    // MERCEDES-EQ EQB China (2).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/2/23/MERCEDES-EQ_EQB_China_%282%29.jpg/960px-MERCEDES-EQ_EQB_China_%282%29.jpg',
  ],
  tesla: [
    // Tesla Model 3, EMS 2024, Essen (P1032260).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/9/97/Tesla_Model_3%2C_EMS_2024%2C_Essen_%28P1032260%29.jpg/960px-Tesla_Model_3%2C_EMS_2024%2C_Essen_%28P1032260%29.jpg',
    // Tesla Model 3 (2023) Autofrühling Ulm IMG 9282.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tesla_Model_3_%282023%29_Autofr%C3%BChling_Ulm_IMG_9282.jpg/960px-Tesla_Model_3_%282023%29_Autofr%C3%BChling_Ulm_IMG_9282.jpg',
    // Tesla Model Y 1X7A6211.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Tesla_Model_Y_1X7A6211.jpg/960px-Tesla_Model_Y_1X7A6211.jpg',
    // Tesla Model Y (2025) MYLE Festival 2025 DSC 9565.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Tesla_Model_Y_%282025%29_MYLE_Festival_2025_DSC_9565.jpg/960px-Tesla_Model_Y_%282025%29_MYLE_Festival_2025_DSC_9565.jpg',
  ],
  mitsubishi: [
    // Алматы, Mitsubishi Pajero во дворе Казыбек би-Наурызбай батыра.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/b/b8/%D0%90%D0%BB%D0%BC%D0%B0%D1%82%D1%8B%2C_Mitsubishi_Pajero_%D0%B2%D0%BE_%D0%B4%D0%B2%D0%BE%D1%80%D0%B5_%D0%9A%D0%B0%D0%B7%D1%8B%D0%B1%D0%B5%D0%BA_%D0%B1%D0%B8-%D0%9D%D0%B0%D1%83%D1%80%D1%8B%D0%B7%D0%B1%D0%B0%D0%B9_%D0%B1%D0%B0%D1%82%D1%8B%D1%80%D0%B0.jpg/960px-%D0%90%D0%BB%D0%BC%D0%B0%D1%82%D1%8B%2C_Mitsubishi_Pajero_%D0%B2%D0%BE_%D0%B4%D0%B2%D0%BE%D1%80%D0%B5_%D0%9A%D0%B0%D0%B7%D1%8B%D0%B1%D0%B5%D0%BA_%D0%B1%D0%B8-%D0%9D%D0%B0%D1%83%D1%80%D1%8B%D0%B7%D0%B1%D0%B0%D0%B9_%D0%B1%D0%B0%D1%82%D1%8B%D1%80%D0%B0.jpg',
    // Mitsubishi Pajero Sport (3rd generation) 1X7A0409.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/1/19/Mitsubishi_Pajero_Sport_%283rd_generation%29_1X7A0409.jpg/960px-Mitsubishi_Pajero_Sport_%283rd_generation%29_1X7A0409.jpg',
    // Mitsubishi Pajero Sport (3rd generation) 1X7A0410.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Mitsubishi_Pajero_Sport_%283rd_generation%29_1X7A0410.jpg/960px-Mitsubishi_Pajero_Sport_%283rd_generation%29_1X7A0410.jpg',
  ],
  interior: [
    // Tesla Model 3 interior.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/1/13/Tesla_Model_3_interior.jpg/960px-Tesla_Model_3_interior.jpg',
    // Hyundai Ioniq 5 NE Interior (2).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Hyundai_Ioniq_5_NE_Interior_%282%29.jpg/960px-Hyundai_Ioniq_5_NE_Interior_%282%29.jpg',
    // BMW G26E i4 Mocha Vernasca Leather (3).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/1/1a/BMW_G26E_i4_Mocha_Vernasca_Leather_%283%29.jpg/960px-BMW_G26E_i4_Mocha_Vernasca_Leather_%283%29.jpg',
  ],
  dashboard: [
    // MG4 EV XPower Automesse Ludwigsburg 2023 1X7A0099.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/d/df/MG4_EV_XPower_Automesse_Ludwigsburg_2023_1X7A0099.jpg/960px-MG4_EV_XPower_Automesse_Ludwigsburg_2023_1X7A0099.jpg',
    // Tesla Model Y 2025 interior.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/5/54/Tesla_Model_Y_2025_interior.jpg/960px-Tesla_Model_Y_2025_interior.jpg',
    // Kia EV6 GT-Line interior.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/6/69/Kia_EV6_GT-Line_interior.jpg/960px-Kia_EV6_GT-Line_interior.jpg',
    // 2026 Hyundai Ioniq 5 N Line (Cockpit).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/2/25/2026_Hyundai_Ioniq_5_N_Line_%28Cockpit%29.jpg/960px-2026_Hyundai_Ioniq_5_N_Line_%28Cockpit%29.jpg',
  ],
  tractor: [
    // Fendt Dieselross F 18 (1939).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Fendt_Dieselross_F_18_%281939%29.jpg/960px-Fendt_Dieselross_F_18_%281939%29.jpg',
    // Tractor New Holland T6.165 plowing (Zadobrova, Ljubljana).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/1/12/Tractor_New_Holland_T6.165_plowing_%28Zadobrova%2C_Ljubljana%29.jpg/960px-Tractor_New_Holland_T6.165_plowing_%28Zadobrova%2C_Ljubljana%29.jpg',
    // John Deere 6R 250, Agritechnica 2023, Hanover (P1140802-RR).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/c/c1/John_Deere_6R_250%2C_Agritechnica_2023%2C_Hanover_%28P1140802-RR%29.jpg/960px-John_Deere_6R_250%2C_Agritechnica_2023%2C_Hanover_%28P1140802-RR%29.jpg',
    // Deutz-Fahr Agrotrac 110 Tractor at IndAgra Farm Romexpo 2010.JPG
    'upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Deutz-Fahr_Agrotrac_110_Tractor_at_IndAgra_Farm_Romexpo_2010.JPG/960px-Deutz-Fahr_Agrotrac_110_Tractor_at_IndAgra_Farm_Romexpo_2010.JPG',
  ],
  harvester: [
    // Claas Lexion 480-20080806-RM-133435.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/1/13/Claas_Lexion_480-20080806-RM-133435.jpg/960px-Claas_Lexion_480-20080806-RM-133435.jpg',
    // Claas Lexion 480-20080806-RM-133439.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Claas_Lexion_480-20080806-RM-133439.jpg/960px-Claas_Lexion_480-20080806-RM-133439.jpg',
    // John Deere Combine Harvester Ebing 1811.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/6/68/John_Deere_Combine_Harvester_Ebing_1811.jpg/960px-John_Deere_Combine_Harvester_Ebing_1811.jpg',
    // Claas Lexion 480 20080806-RM-133543.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Claas_Lexion_480_20080806-RM-133543.jpg/960px-Claas_Lexion_480_20080806-RM-133543.jpg',
  ],
  tiller: [
    // Tractor with cultivator - geograph.org.uk - 459621.jpg
    'upload.wikimedia.org/wikipedia/commons/e/ee/Tractor_with_cultivator_-_geograph.org.uk_-_459621.jpg',
    // Craftsman Cultivator East Haven VT June 2019.jpg
    'upload.wikimedia.org/wikipedia/commons/3/3e/Craftsman_Cultivator_East_Haven_VT_June_2019.jpg',
    // Gasoline cultivator.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Gasoline_cultivator.jpg/960px-Gasoline_cultivator.jpg',
  ],
  excavator: [
    // 2023-02-13 - JCB JS220LC hydraulic excavator - 01.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/2/2d/2023-02-13_-_JCB_JS220LC_hydraulic_excavator_-_01.jpg/960px-2023-02-13_-_JCB_JS220LC_hydraulic_excavator_-_01.jpg',
    // 2023-02-13 - JCB JS220LC hydraulic excavator - 03.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/1/18/2023-02-13_-_JCB_JS220LC_hydraulic_excavator_-_03.jpg/960px-2023-02-13_-_JCB_JS220LC_hydraulic_excavator_-_03.jpg',
    // 2023-02-13 - JCB JS220LC hydraulic excavator - 02.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/8/85/2023-02-13_-_JCB_JS220LC_hydraulic_excavator_-_02.jpg/960px-2023-02-13_-_JCB_JS220LC_hydraulic_excavator_-_02.jpg',
    // Zoomlion ZE700GC Mining Hydraulic Excavator 20210522.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/2/27/Zoomlion_ZE700GC_Mining_Hydraulic_Excavator_20210522.jpg/960px-Zoomlion_ZE700GC_Mining_Hydraulic_Excavator_20210522.jpg',
  ],
  bulldozer: [
    // Caterpillar D6 bulldozer VA2.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Caterpillar_D6_bulldozer_VA2.jpg/960px-Caterpillar_D6_bulldozer_VA2.jpg',
    // Komatsu bulldozer pushing coal in Power plant Ljubljana (winter 2017).jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/9/97/Komatsu_bulldozer_pushing_coal_in_Power_plant_Ljubljana_%28winter_2017%29.jpg/960px-Komatsu_bulldozer_pushing_coal_in_Power_plant_Ljubljana_%28winter_2017%29.jpg',
  ],
  loader: [
    // CATERPILLAR 950 GC Wheel Loader 04.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/4/4f/CATERPILLAR_950_GC_Wheel_Loader_04.jpg/960px-CATERPILLAR_950_GC_Wheel_Loader_04.jpg',
    // Volvo Skid Steer Wheel Loaders.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/d/db/Volvo_Skid_Steer_Wheel_Loaders.jpg/960px-Volvo_Skid_Steer_Wheel_Loaders.jpg',
    // Komatsu WA500 wheel loader for gravel mining.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/9/98/Komatsu_WA500_wheel_loader_for_gravel_mining.jpg/960px-Komatsu_WA500_wheel_loader_for_gravel_mining.jpg',
  ],
  crane: [
    // A Liebherr LTM 1500-8.1 crane truck in Taiwan 01.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/3/30/A_Liebherr_LTM_1500-8.1_crane_truck_in_Taiwan_01.jpg/960px-A_Liebherr_LTM_1500-8.1_crane_truck_in_Taiwan_01.jpg',
    // Grove GMK 3050 - 25 tons mobile crane - Belgian Army.png
    'upload.wikimedia.org/wikipedia/commons/thumb/0/02/Grove_GMK_3050_-_25_tons_mobile_crane_-_Belgian_Army.png/960px-Grove_GMK_3050_-_25_tons_mobile_crane_-_Belgian_Army.png',
    // Liebherr LTM 1100-5.1.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Liebherr_LTM_1100-5.1.jpg/960px-Liebherr_LTM_1100-5.1.jpg',
    // Southern Cranes Liebherr mobile crane within the Mountbatten House construction site at Chatham Waterfront.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Southern_Cranes_Liebherr_mobile_crane_within_the_Mountbatten_House_construction_site_at_Chatham_Waterfront.jpg/960px-Southern_Cranes_Liebherr_mobile_crane_within_the_Mountbatten_House_construction_site_at_Chatham_Waterfront.jpg',
  ],
  forklift: [
    // Hyster forklift.jpg
    'upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Hyster_forklift.jpg/960px-Hyster_forklift.jpg',
    // Heck Stapler Manitou.JPG
    'upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Heck_Stapler_Manitou.JPG/960px-Heck_Stapler_Manitou.JPG',
  ],
} satisfies Record<string, readonly string[]>;

/** Any make we have no pool for falls back to a mixed set of real cars. */
const GENERIC_CAR: readonly string[] = [...POOLS.toyota, ...POOLS.tesla, ...POOLS.hyundai];

/**
 * Map a descriptor keyword onto a pool. Order matters: `farm,harvest` is a
 * harvester while `farm,machinery` is a tractor, and `loader,construction` is a
 * loader before it is anything construction-shaped.
 */
function poolFor(keyword: string): readonly string[] {
  const k = keyword.toLowerCase();
  if (k === 'car,interior') return POOLS.interior;
  if (k === 'car,dashboard') return POOLS.dashboard;

  const tokens = k.split(',');
  const has = (t: string) => tokens.includes(t);
  if (has('harvester') || has('harvest')) return POOLS.harvester;
  if (has('tractor')) return POOLS.tractor;
  if (has('cultivator')) return POOLS.tiller;
  if (has('farm')) return POOLS.tractor;
  if (has('excavator') || has('digger')) return POOLS.excavator;
  if (has('bulldozer')) return POOLS.bulldozer;
  if (k.includes('loader')) return POOLS.loader; // also matches `wheel-loader`
  if (has('crane')) return POOLS.crane;
  if (has('forklift')) return POOLS.forklift;
  if (has('construction') || has('machinery') || has('site')) return POOLS.excavator;

  // Car exteriors arrive as `<make>,car` (or plain `car`).
  const make = tokens.find((t) => t !== 'car');
  if (make && make in POOLS) return POOLS[make as keyof typeof POOLS];
  return GENERIC_CAR;
}

/**
 * FNV-1a. Picking the photo with `lock % pool.length` would repeat: a make recurs
 * every 12 rows in the seed and the pools hold 3–4 photos, so the stride is a
 * multiple of the pool size and every BMW lands on the same picture. Hashing the
 * whole descriptor decorrelates the index from the stride while staying stable.
 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Resolve a stored photo URL to something that actually loads. Demo descriptors map
 * to a curated CDN photo; every other URL (real Supabase uploads, data URIs) is
 * returned untouched.
 */
export function resolvePhoto(url: string | null | undefined): string {
  if (!url) return PHOTO_FALLBACK;
  const m = DESCRIPTOR.exec(url);
  if (!m) return url;
  const [, keyword, lock] = m;
  const pool = poolFor(keyword);
  return cdn(pool[hash(`${keyword}:${lock}`) % pool.length]);
}
