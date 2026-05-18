const HOST = "yahoo-finance-real-time1.p.rapidapi.com";
const KEY = "0d6b10fe86mshaf757ad0ada2533p1963f6jsn74204fe24d52";

const PATHS = [
  "/api/v1/finance/quote?symbol=AAPL",
  "/v1/finance/quote?symbol=AAPL",
  "/finance/quote?symbol=AAPL",
  "/get-quotes?symbol=AAPL",
  "/stock/get-quotes?symbol=AAPL",
  "/api/yahoo/qu/quote/AAPL",
  "/stock/v2/get-summary?symbol=AAPL",
  "/market/get-quotes?region=US&symbols=AAPL",
  "/v6/finance/quote?symbols=AAPL",
  "/v7/finance/quote?symbols=AAPL",
  "/api/yahoo/qu/quote/AAPL",
];

async function run() {
  for (const p of PATHS) {
    console.log(`Testing ${p}`);
    try {
      const res = await fetch(`https://${HOST}${p}`, {
        headers: {
          "X-RapidAPI-Host": HOST,
          "X-RapidAPI-Key": KEY,
        }
      });
      const text = await res.text();
      if (!text.includes("does not exist")) {
        console.log(`SUCCESS [${res.status}]: ${p}`);
        console.log(text.substring(0, 200));
      }
    } catch (e) {
      console.log('Error', e.message);
    }
  }
}
run();
