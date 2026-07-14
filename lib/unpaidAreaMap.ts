// lib/unpaidAreaMap.ts
// 2026年7月 課別人員表(セクション4=エリア / セクション5=テリトリー)より生成。
// フィットネス(JOYFIT/FIT365)店舗のみ。非フィットネス施設(スイミング等)は除外。
export type TerritoryDef = { territory: string; clubCodes: string[] };
export type AreaDef = { area: string; block: string; clubCodes: string[]; territories: TerritoryDef[] };
export const UNPAID_AREAS: AreaDef[] = [
  {
    "area": "関東 第1エリア",
    "block": "関東",
    "clubCodes": [
      "204",
      "220",
      "221",
      "225",
      "386",
      "1303",
      "1385",
      "366",
      "329",
      "362"
    ],
    "territories": [
      {
        "territory": "テリトリー1",
        "clubCodes": [
          "204",
          "220",
          "221",
          "225"
        ]
      },
      {
        "territory": "テリトリー2",
        "clubCodes": [
          "386",
          "1303",
          "1385",
          "366",
          "329",
          "362"
        ]
      }
    ]
  },
  {
    "area": "関東 第2エリア",
    "block": "関東",
    "clubCodes": [
      "375",
      "337",
      "333",
      "332",
      "379",
      "349",
      "355",
      "316",
      "323",
      "338",
      "385",
      "331",
      "1309",
      "371",
      "1308",
      "359"
    ],
    "territories": [
      {
        "territory": "テリトリー1",
        "clubCodes": [
          "375",
          "337",
          "333",
          "332",
          "379",
          "349"
        ]
      },
      {
        "territory": "テリトリー2",
        "clubCodes": [
          "355",
          "316",
          "323",
          "338",
          "385"
        ]
      },
      {
        "territory": "テリトリー3",
        "clubCodes": [
          "331",
          "1309",
          "371",
          "1308",
          "359"
        ]
      }
    ]
  },
  {
    "area": "関東 第3エリア",
    "block": "関東",
    "clubCodes": [
      "321",
      "1331",
      "1356",
      "308",
      "343",
      "327",
      "1306",
      "383",
      "356",
      "1302",
      "1305",
      "1375",
      "358",
      "322",
      "1328"
    ],
    "territories": [
      {
        "territory": "テリトリー1",
        "clubCodes": [
          "321",
          "1331",
          "1356",
          "308"
        ]
      },
      {
        "territory": "テリトリー2",
        "clubCodes": [
          "343",
          "327",
          "1306",
          "383",
          "356"
        ]
      },
      {
        "territory": "テリトリー3",
        "clubCodes": [
          "1302",
          "1305",
          "1375",
          "358",
          "322",
          "1328"
        ]
      }
    ]
  },
  {
    "area": "関東 第4エリア",
    "block": "関東",
    "clubCodes": [
      "340",
      "374",
      "1369",
      "1384",
      "1346",
      "1382",
      "367",
      "381",
      "380",
      "361",
      "347",
      "336",
      "384",
      "1301",
      "1319",
      "1307",
      "1372"
    ],
    "territories": [
      {
        "territory": "テリトリー1",
        "clubCodes": [
          "340",
          "374",
          "1369",
          "1384"
        ]
      },
      {
        "territory": "テリトリー2",
        "clubCodes": [
          "1346",
          "1382",
          "367"
        ]
      },
      {
        "territory": "テリトリー3",
        "clubCodes": [
          "381",
          "380",
          "361",
          "347",
          "336"
        ]
      },
      {
        "territory": "テリトリー4",
        "clubCodes": [
          "384",
          "1301",
          "1319",
          "1307",
          "1372"
        ]
      }
    ]
  },
  {
    "area": "関東 第5エリア",
    "block": "関東",
    "clubCodes": [
      "325",
      "370",
      "376",
      "1325",
      "365",
      "1391",
      "344",
      "342",
      "360",
      "1343",
      "1338",
      "1318",
      "368",
      "339",
      "1348"
    ],
    "territories": [
      {
        "territory": "テリトリー1",
        "clubCodes": [
          "325",
          "370",
          "376",
          "1325",
          "365"
        ]
      },
      {
        "territory": "テリトリー2",
        "clubCodes": [
          "1391",
          "344",
          "342",
          "360",
          "1343"
        ]
      },
      {
        "territory": "テリトリー3",
        "clubCodes": [
          "1338",
          "1318",
          "368",
          "339",
          "1348"
        ]
      }
    ]
  },
  {
    "area": "関東 第6エリア",
    "block": "関東",
    "clubCodes": [
      "1357",
      "364",
      "1311",
      "1374",
      "1354",
      "314",
      "1379",
      "341",
      "1310",
      "382",
      "1314",
      "1351",
      "1316",
      "1323",
      "320",
      "1355"
    ],
    "territories": [
      {
        "territory": "テリトリー1",
        "clubCodes": [
          "1357",
          "364",
          "1311",
          "1374",
          "1354"
        ]
      },
      {
        "territory": "テリトリー2",
        "clubCodes": [
          "314",
          "1379",
          "341",
          "1310",
          "382"
        ]
      },
      {
        "territory": "テリトリー3",
        "clubCodes": [
          "1314",
          "1351",
          "1316",
          "1323",
          "320",
          "1355"
        ]
      }
    ]
  },
  {
    "area": "関東 第7エリア",
    "block": "関東",
    "clubCodes": [
      "315",
      "330",
      "1304"
    ],
    "territories": [
      {
        "territory": "テリトリー1",
        "clubCodes": [
          "315",
          "330"
        ]
      },
      {
        "territory": "テリトリー2",
        "clubCodes": [
          "1304"
        ]
      }
    ]
  },
  {
    "area": "西日本 第1エリア",
    "block": "西日本",
    "clubCodes": [
      "404",
      "410",
      "419",
      "406",
      "409",
      "408"
    ],
    "territories": [
      {
        "territory": "テリトリー1",
        "clubCodes": [
          "404",
          "410",
          "419",
          "406",
          "409",
          "408"
        ]
      }
    ]
  },
  {
    "area": "西日本 第2エリア",
    "block": "西日本",
    "clubCodes": [
      "523",
      "524",
      "544",
      "539",
      "541",
      "545",
      "538",
      "567",
      "505",
      "507",
      "526",
      "527",
      "529",
      "511",
      "564",
      "1513",
      "547",
      "509",
      "512",
      "519",
      "543",
      "516",
      "534",
      "1505",
      "1508",
      "1507",
      "1522",
      "1509",
      "1521",
      "1512",
      "1524"
    ],
    "territories": [
      {
        "territory": "テリトリー1",
        "clubCodes": [
          "523",
          "524",
          "544",
          "539",
          "541",
          "545",
          "538",
          "567"
        ]
      },
      {
        "territory": "テリトリー2",
        "clubCodes": [
          "505",
          "507",
          "526",
          "527",
          "529",
          "511",
          "564"
        ]
      },
      {
        "territory": "テリトリー3",
        "clubCodes": [
          "1513",
          "547",
          "509",
          "512",
          "519",
          "543",
          "516",
          "534"
        ]
      },
      {
        "territory": "テリトリー4",
        "clubCodes": [
          "1505",
          "1508",
          "1507",
          "1522",
          "1509",
          "1521",
          "1512",
          "1524"
        ]
      }
    ]
  },
  {
    "area": "西日本 第3エリア",
    "block": "西日本",
    "clubCodes": [
      "504",
      "530",
      "540",
      "554",
      "535",
      "1502",
      "1519",
      "1515",
      "227",
      "1518",
      "1525"
    ],
    "territories": [
      {
        "territory": "テリトリー1",
        "clubCodes": [
          "504",
          "530",
          "540",
          "554",
          "535"
        ]
      },
      {
        "territory": "テリトリー2",
        "clubCodes": [
          "1502",
          "1519",
          "1515",
          "227",
          "1518",
          "1525"
        ]
      }
    ]
  },
  {
    "area": "西日本 第4エリア",
    "block": "西日本",
    "clubCodes": [
      "603",
      "606"
    ],
    "territories": [
      {
        "territory": "テリトリー1",
        "clubCodes": [
          "603"
        ]
      },
      {
        "territory": "テリトリー2",
        "clubCodes": [
          "606"
        ]
      }
    ]
  },
  {
    "area": "西日本 第5エリア",
    "block": "西日本",
    "clubCodes": [
      "832",
      "814",
      "810",
      "804",
      "817",
      "812",
      "805",
      "820",
      "821",
      "903",
      "902",
      "819",
      "826",
      "825",
      "828",
      "905"
    ],
    "territories": [
      {
        "territory": "テリトリー1",
        "clubCodes": [
          "832",
          "814",
          "810",
          "804",
          "817",
          "812"
        ]
      },
      {
        "territory": "テリトリー2",
        "clubCodes": [
          "805",
          "820",
          "821"
        ]
      },
      {
        "territory": "テリトリー3",
        "clubCodes": [
          "903",
          "902"
        ]
      },
      {
        "territory": "テリトリー4",
        "clubCodes": [
          "819",
          "826",
          "825",
          "828"
        ]
      },
      {
        "territory": "テリトリー5",
        "clubCodes": [
          "905"
        ]
      }
    ]
  },
  {
    "area": "四国 フィットネス部門/JOYFITエリア",
    "block": "四国",
    "clubCodes": [
      "701",
      "711",
      "703"
    ],
    "territories": [
      {
        "territory": "（テリトリー未設定）",
        "clubCodes": [
          "701",
          "711",
          "703"
        ]
      }
    ]
  },
  {
    "area": "FIT365エリア",
    "block": "四国",
    "clubCodes": [
      "705",
      "701",
      "710",
      "703",
      "711",
      "706"
    ],
    "territories": [
      {
        "territory": "（テリトリー未設定）",
        "clubCodes": [
          "705",
          "701",
          "710",
          "703",
          "711",
          "706"
        ]
      }
    ]
  }
];

// clubCode → { area, block, territory } の逆引きを構築する。
// 店舗一覧などで「エリア / テリトリー」列を出すために使う。
export function buildClubAreaLookup(): Record<string, { area: string; block: string; territory: string }> {
  const map: Record<string, { area: string; block: string; territory: string }> = {};
  for (const a of UNPAID_AREAS) {
    for (const code of a.clubCodes) {
      const k = String(code);
      if (!map[k]) map[k] = { area: a.area, block: a.block, territory: "" };
    }
    for (const t of a.territories) {
      for (const code of t.clubCodes) {
        map[String(code)] = { area: a.area, block: a.block, territory: t.territory };
      }
    }
  }
  return map;
}
