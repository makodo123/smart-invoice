powershell -Command "(gc .env.local) -replace 'GEMINI_API_KEY=PLACEHOLDER_API_KEY', 'GEMINI_API_KEY=AIzaSyCDKzkJUQExCH36e0gb2O3vNxQ8GJxoIGA' | Out-File -encoding utf8 .env.local"
npm install&&npm run dev
