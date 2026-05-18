import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'client/src/pages/MacroPage.tsx');
let code = fs.readFileSync(file, 'utf8');

// 1. Add useQuery import
if (!code.includes('@tanstack/react-query')) {
  code = code.replace(
    'import { useState } from "react";',
    'import { useState } from "react";\nimport { useQuery } from "@tanstack/react-query";'
  );
}

// 2. Update IndicesSection
code = code.replace(/function IndicesSection\(\) \{/g, 'function IndicesSection({ data }: { data: any }) {');
code = code.replace(
  /\{INDICES\.map\(idx => \(/g,
  `{INDICES.map(baseIdx => {
          const liveMatch = data?.indices?.find((d: any) => d.key === baseIdx.ticker);
          const idx = liveMatch ? { ...baseIdx, value: liveMatch.data?.price?.toFixed(2) || baseIdx.value, chg: liveMatch.data?.dayChange || baseIdx.chg } : baseIdx;
          return (`
);
code = code.replace(/<div key=\{idx\.ticker\} style=\{\{ \.\.\.s\.card/g, '<div key={idx.ticker} style={{ ...s.card');
code = code.replace(/<div style=\{s\.sub\}>\{idx\.name\}<\/div>\n\s*?<\/div>\n\s*?\)\)}/g, '<div style={s.sub}>{idx.name}</div>\n          </div>\n        );})}');

// 3. Update MacroStatsSection
code = code.replace(/function MacroStatsSection\(\) \{/g, 'function MacroStatsSection({ data }: { data: any }) {');
code = code.replace(
  /\{MACRO_STATS\.map\(\(stat, i\) => \(/g,
  `{MACRO_STATS.map((baseStat, i) => {
          let stat = { ...baseStat };
          if (stat.label === "WTI Crude") {
            const match = data?.commodities?.find((c: any) => c.key === "WTI Crude");
            if (match) { stat.value = "$" + match.data?.price?.toFixed(2); stat.delta = match.data?.dayChange; }
          }
          if (stat.label === "Gold") {
            const match = data?.commodities?.find((c: any) => c.key === "Gold");
            if (match) { stat.value = "$" + match.data?.price?.toFixed(0); stat.delta = match.data?.dayChange; }
          }
          if (stat.label === "DXY (USD)") {
            const match = data?.other?.find((o: any) => o.key === "DXY");
            if (match) { stat.value = match.data?.price?.toFixed(2); stat.delta = match.data?.dayChange; }
          }
          if (stat.label === "Euro / USD") {
            const match = data?.other?.find((o: any) => o.key === "EURUSD");
            if (match) { stat.value = match.data?.price?.toFixed(4); stat.delta = match.data?.dayChange; }
          }
          if (stat.label === "USD / JPY") {
            const match = data?.other?.find((o: any) => o.key === "USDJPY");
            if (match) { stat.value = match.data?.price?.toFixed(2); stat.delta = match.data?.dayChange; }
          }
          return (
`
);

code = code.replace(/\{stat\.delta !== undefined && <Delta v=\{stat\.delta\} \/>\}\n\s*?<\/div>\n\s*?\)\)}/g, '{stat.delta !== undefined && <Delta v={stat.delta} />}\n          </div>\n        );})}');

// 4. Update YieldCurveSection
code = code.replace(/function YieldCurveSection\(\) \{/g, 'function YieldCurveSection({ data }: { data: any }) {');
code = code.replace(
  /<LineChart data=\{YIELD_DATA\}/,
  `<LineChart data={(YIELD_DATA.map(y => {
              const liveMatch = data?.yields?.find((d: any) => d.key === y.maturity);
              return liveMatch && liveMatch.data?.price ? { ...y, yield: liveMatch.data.price / (liveMatch.divider || 1) } : y;
            }))}`
);
code = code.replace(
  /\{YIELD_DATA\.filter/g,
  `{(YIELD_DATA.map(y => {
              const liveMatch = data?.yields?.find((d: any) => d.key === y.maturity);
              return liveMatch && liveMatch.data?.price ? { ...y, yield: liveMatch.data.price / (liveMatch.divider || 1) } : y;
            })).filter`
);

// 5. Update CommoditiesSection
code = code.replace(/function CommoditiesSection\(\) \{/g, 'function CommoditiesSection({ data }: { data: any }) {');
code = code.replace(
  /\{COMMODITIES\.map\(c => \(/g,
  `{COMMODITIES.map(baseC => {
            const liveMatch = data?.commodities?.find((d: any) => d.key === baseC.name);
            const c = liveMatch ? { ...baseC, value: (baseC.name === "Bitcoin" ? "$" + liveMatch.data?.price?.toFixed(0) : "$" + liveMatch.data?.price?.toFixed(2)), chg: liveMatch.data?.dayChange || baseC.chg } : baseC;
            return (
`
);
code = code.replace(/YTD \{c\.chg > 0 \? "\+" : ""\}\{c\.chg\.toFixed\(1\)\}%(?:.|\n)*?<\/div>\n\s*?<\/div>\n\s*?\)\)}/g, 'YTD {c.chg > 0 ? "+" : ""}{c.chg.toFixed(1)}%\n              </div>\n            </div>\n          );})}');

// 6. Update BigMacSection
code = code.replace(/function BigMacSection\(\) \{/g, 'function BigMacSection({ data }: { data: any }) {\n  const bigMacData = data?.bigMac?.length > 0 ? data.bigMac : BIG_MAC_DATA;');
code = code.replace(/<BarChart data=\{BIG_MAC_DATA\}/g, '<BarChart data={bigMacData}');
code = code.replace(/\{BIG_MAC_DATA\.map/g, '{bigMacData.map');

// 7. Update MacroPage main component
code = code.replace(
  /export default function MacroPage\(\) \{/,
  `export default function MacroPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/macro"],
    queryFn: async () => {
      const res = await fetch("/api/macro");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return <div style={{ padding: "20px", color: "var(--bb-text-muted)" }}>Chargement des données macroéconomiques via Yahoo Finance...</div>;
  }`
);

code = code.replace(/<IndicesSection \/>/g, '<IndicesSection data={data} />');
code = code.replace(/<MacroStatsSection \/>/g, '<MacroStatsSection data={data} />');
code = code.replace(/<YieldCurveSection \/>/g, '<YieldCurveSection data={data} />');
code = code.replace(/<CommoditiesSection \/>/g, '<CommoditiesSection data={data} />');
code = code.replace(/<BigMacSection \/>/g, '<BigMacSection data={data} />');


fs.writeFileSync(file, code);
console.log('MacroPage correctly patched!');
