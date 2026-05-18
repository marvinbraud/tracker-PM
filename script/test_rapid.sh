#!/bin/bash
HOST="yahoo-finance-real-time1.p.rapidapi.com"
KEY="0d6b10fe86mshaf757ad0ada2533p1963f6jsn74204fe24d52"
PATHS=(
  "/api/v1/finance/quote?symbol=AAPL"
  "/v1/finance/quote?symbol=AAPL"
  "/finance/quote?symbol=AAPL"
  "/get-quotes?symbol=AAPL"
  "/stock/get-quotes?symbol=AAPL"
  "/api/yahoo/qu/quote/AAPL"
  "/stock/v2/get-summary?symbol=AAPL"
  "/market/get-quotes?region=US&symbols=AAPL"
  "/v6/finance/quote?symbols=AAPL"
  "/v7/finance/quote?symbols=AAPL"
)
for PATH in "${PATHS[@]}"; do
  echo "Testing $PATH"
  RES=$(curl -s "https://${HOST}${PATH}" -H "X-RapidAPI-Host: ${HOST}" -H "X-RapidAPI-Key: ${KEY}")
  if [[ "$RES" != *"does not exist"* ]]; then
    echo "SUCCESS: $RES"
  fi
done
