// backend/src/data/sideNationBackfill.ts
//
// One-off "Side & Nation" tags for the live catalogue when that facet was added
// (30 Oct 2026). Applied by scripts/seed-taxonomy.ts only on the run that first
// creates the facet, so artists' later edits are never overwritten. Worked out
// from each listing's name/description (e.g. "(Germany, WW2)"); neutral or mixed
// pieces (trench tiles, generic objective markers, Canada House) are left blank.

/** side-nation term path -> model ids */
export const SIDE_NATION_BACKFILL: Record<string, string[]> = {
  'nato/france': [
    '8117bf97-0521-4004-8f14-3278b3f627de', // AMX-10P (France, NATO, 1980s)
    'f20d776f-c4a9-421b-a025-59577c92d876', // VAB Mephisto HOT (France, NATO, 1980s)
    '5a36c074-6310-4f1f-abdd-3281a5fa0fcb', // VAB VCI T20 with 20mm autocanon (France, NATO, 1980s)
  ],
  'nato/other-nato': [
    'bf7abe69-7cd1-44a8-9060-950556cf7b52', // YPR-765 PRI (Netherlands, Belgium, NATO, 1980s)
  ],
  'nato/united-kingdom': [
    '7958e500-3028-4eb4-9fd7-2f5c9ec2f508', // Centurion Mk.V (UK, Cold war)
    'fb545e89-8145-486b-bf01-006a29b99fea', // FV4201 Chieftain Mk.10 + Mk.11 (UK, NATO, 1980s)
    '0e97af86-5ffb-4446-9caa-b3688163561c', // FV432 APC Mk.2/1 (UK, NATO, 1980s)
    'd422804e-caf1-49c5-b319-a8fd9ddc5e96', // Land Rover Defender 110 Wolf (UK, NATO, 1980s)
  ],
  'nato/united-states': [
    'cc10fc69-f6eb-4881-a1f9-343bfc7dcfea', // M1 Abrams M1IP version (105mm gun) (US, NATO, 1980s)
    'd2576fee-88f1-4bcc-987f-7b534d846f34', // M1128 Stryker (US, Modern)
    '175b5e10-d2db-44a8-9298-d05a0a41f3ab', // M163A1 VADS Vulcan (US, NATO, 1980s)
    '0ccc5582-fde1-440b-8025-0e95f9aeb217', // M60A3 Patton (US, Cold War)
    'f1cf0c7a-8d33-4ce8-bbbe-e441748c8b77', // M901A1 Hummer TOW launcher Tank Hunter (US, NATO, 1980s)
  ],
  'ww2-allies/commonwealth': [
    '1c7f2072-ec3b-4097-8abf-08b505183cde', // Bob Semple Tank (New Zealand, WW2)
  ],
  'ww2-allies/soviet-union': [
    'e771d47a-3323-4da2-800f-4de42088c7ca', // M1937 ML-20 152mm + 2 Gunners (USSR, WW2)
    'a4156e0f-703c-4048-ad36-269920416e50', // M30 122mm Howitzer + 2 Gunners (USSR, WW2)
    '188981bd-8961-424e-8b91-757dd15c7819', // SU-76M Self-Propelled Gun (USSR, WW2)
    '94ea2843-0dfa-45b9-9067-e6de58fc9347', // ZIS-2 57mm AT gun + ZIS-3 76.2mm divisional gun (USSR, WW2)
  ],
  'ww2-allies/united-kingdom': [
    'f618dd35-c3e7-4a4c-87d4-190d08b01bb1', // 17/25-pdr Anti-tank Gun Pheasant + 2 Gunners (UK, WW2)
    '64b6c12d-d504-43b3-9fec-c3adc8459f8b', // BL 5.5-inch medium gun + 2 Gunners (UK, WW2)
    '672ec727-a78d-487f-b72d-605ef6f0e7b9', // Churchill Mk.IV Fascine Carrier (UK, WW2)
    '3ac165c1-995e-4a10-8a29-1b90f2d8fb69', // Covenanter (A13 Mk. III)
    '788249a1-53d4-4dc9-85d6-3c956e851f63', // Cromwell Mk. V
    '16b710d6-1d62-433b-883f-309e5d6de0bb', // Crusader Mk. III
    '70fb99e6-7923-4059-8aca-6dc6c9e7bafb', // Landing Craft Assault — LCA (UK, D-Day, WW2)
    '78d20de9-7bc6-4308-85a3-28792a6d1cf1', // Valentine Mk. III
  ],
  'ww2-allies/united-states': [
    'b8045325-8ebb-4c8b-8c98-28d3d5507cfe', // 155mm M1 Howitzer + 2 Gunners (US, WW2)
    'f1c68804-636d-4a82-9e2d-aa773540f354', // Caterpillar D8 (US, WW2)
    '58dbb0e7-4c2d-4984-a546-59072f9380dd', // M-101 (M2A1) 105mm howitzer (US, WW2)
    'c087ca5f-cc7c-4f12-a535-7cbe92055052', // M1/M2 90mm AA gun + 2 Gunners (US, WW2)
    'fbf4d58d-9aff-4d77-b35f-da587703a822', // M24 Chaffee
    'dc302fde-3b59-4533-b038-fa4b554ca3aa', // M2A1 Half-Track (US, WW2)
    '10153cb7-48b4-4cf6-9fcc-e124983c17a8', // M3 Lee
    '9add2312-3b46-4f40-ac1c-5cb9785ae444', // M3A1 Stuart
    '543a98b8-ce0b-4427-b328-9ce654fcd4e7', // M4A3E2 "Jumbo" Sherman (copy)
    '5853bca7-7b11-434a-a710-08067fb34452', // M4A3E8(76) "Easy Eight" Sherman
    '587aeca6-9d30-4b66-b287-54e1a8ece6c3', // M5 Half-Track (US, WW2)
    '9f30b639-126a-44e3-afa8-194d2fa0ed85', // M5A1 Stuart
    'a15b16e4-2bc7-417f-95fd-7deaf03030f5', // M5A1 Stuart Light Tank (US, WW2)
    '57eeab54-0bce-4d4b-90f1-fa8dcef6a68b', // Stowage for Sherman Tanks (US, WW2)
  ],
  'ww2-axis/germany': [
    'd4a63a17-91e5-4389-b515-34744699baab', // 37mm Flak 43 Zwilling + 1 Gunner (Germany, WW2)
    'a105e07f-a3bd-45a9-a0eb-6fe90fc67e05', // 5cm Flak 41+1 gunner (Germany, WW2)
    '5b6aa19d-d262-43c0-bd9d-a0d6a5a318bc', // Bunker Regelbau 611 (Juno Beach, D-Day, WW2)
    'faf35847-bdec-4518-a2e6-684f34dd0e76', // Bunker Regelbau M272 (Longues-sur-Mer, Juno Beach, D-Day)
    '73310b84-cbaf-4735-b441-1b8a74877192', // Bunker Tobruk Regelbau 58c (Juno Beach, D-Day, WW2)
    'd98fad36-cc10-4f05-a3a5-6b06885bf6cf', // Daimler Benz Panther (VK 30.02) + 3 Tankmen (Germany, WW2)
    '54401e59-8cdc-41ae-84c1-1df3d62a35f6', // LeFH 18 10.5cm light howitzer (Germany, WW2)
    '243857cb-cd8f-4af3-994b-dbaad07c9df5', // Mobile MG Bunker Panzernest (Germany, WW2)
    'd84f3ece-41e6-4a61-84a1-70ad789bd380', // Objective Marker #40 (60mm) - Destroyed Pak 44 (Germany, WW2)
    '88481dfd-0216-41ab-add3-8e7db68d3420', // Objective Marker #41 (60mm) - Destroyed VW Kubelwagen (Germany, WW2)
    'ad0de486-daad-47be-94b9-e3ee06e232de', // Objective Marker #43 (60mm) - Sd.Kfz.2 Kettenkrad (Germany, WW2)
    '4002f526-632f-4dd6-8291-53c42b00b919', // Objective Marker #44 (60mm) - VW Schwimmwagen, Damaged + Intact (Germany, WW2)
    'be9d6d1f-93d4-47bb-8edb-b25e5d2d346a', // Panzer I AusF A
    'f0fb8820-ed1c-4194-8a90-cb6cdef9b239', // Panzer I AusF B
    '9b006482-6e73-4812-9f98-b6bdee93543e', // Panzer I AusF C
    '3771a88b-4ba5-4f2c-b55c-24fdb80fbb0a', // Panzer I AusF F
    'e83033d6-f492-4582-988d-a9e335403448', // Panzer II AusF C
    '8855a1cb-0345-46f2-acff-6f3dd29aad4f', // Panzer II AusF D
    'a758faff-d3ad-410f-b8ea-ad203af41593', // Panzer II AusF F
    '0e727490-8aa9-4483-8e8a-8b73833c0c22', // Panzer II AusF G
    '500dc6e0-ec10-442c-af9d-3107b7e6ba73', // Panzer II AusF J
    'a1e9b15c-58d0-4470-9c63-b4a79b8856ec', // Panzer II AusF L "Luchs"
    '1d873aa3-c509-409d-89cf-e85b55151d40', // Panzer II AusF a2 (Pre-production)
    '67666765-b249-45d4-ab67-40546c662191', // Panzer IV Ausf.H with Side Skirts + 3 Tankmen (Germany, WW2)
    '8c77b550-52ca-46a2-8240-9ed769273d04', // Rocket launcher 21cm Nebelwerfer (Germany, WW2)
    '4c320e3e-105b-492a-9e6c-f570c2988061', // Schwerer Gustav 80cm railway gun + 3 Gunners (Germany, WW2)
    '6e520900-2d31-419e-835c-4ca1e758f997', // Tiger I Ausf.E (Sd.Kfz.181) + 3 Tankmen (Germany, WW2)
  ],
  'ww2-axis/italy': [
    '529257d4-1b37-4615-a8b7-6d8474a688ba', // Objective Marker #19 (60mm) - Breda 20/65 Modello 1935 (Italy, WW2)
  ],
  'ww2-axis/japan': [
    '3111d8dc-3636-4c79-9376-330d3a31e0b0', // Objective Marker #39 (60mm) - Gas Scattering Trailer (Japan, WW2)
  ],
}
