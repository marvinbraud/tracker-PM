async function main() {
  const { default: yahooFinance } = await import('yahoo-finance2');
  console.log('quote exists:', !!yahooFinance?.quote);
  try {
    const result = await yahooFinance.quote(['^GSPC', 'AAPL']);
    console.log('Result:', result.length);
  } catch (e) {
    console.error('Error in quote:', e);
  }
}
main();
