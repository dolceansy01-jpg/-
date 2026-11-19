EDI BOT - KÒMANSMAN

Sa ki nan pwojè a
- WhatsApp bot sou Baileys
- API Express ak /health
- Pairing code pwoteje ak yon kle sekrè
- Kòmand: .menu, .ping, .botinfo, .rules, .admins, .antilink, .antispam, .warn, .unwarn, .kick, .mute, .unmute, .tagall, .hidetag, .setrules
- Otorizasyon admin pou kòmand modération
- Done gwoup yo nan groups.json

ENPÒTAN
1. Kreye yon sèvis Web sou Render ak repo GitHub pwojè sa a.
2. Mete Node 20 oswa pi wo.
3. Mete varyab anviwònman yo: PAIRING_SECRET, OWNER_NUMBER, PAIRING_PHONE, AUTH_DIR=/var/data/auth, DATA_DIR=/var/data/data, PREFIX=.
4. Ajoute yon persistent disk ki monte sou /var/data. San disk pèmanan, sesyon WhatsApp ak paramèt gwoup yo ka pèdi lè sèvis la rekòmanse.
5. Apre sèvis la demare, rele POST https://ADRES-SERVIS-RENDER/pair ak header x-api-key ki gen menm valè PAIRING_SECRET la, epi JSON: {"phone":"509XXXXXXXX"}. Nimewo a dwe nan fòma entènasyonal, chif sèlman.
6. Pran pairingCode nan repons lan. Sou WhatsApp: Aparèy konekte > Konekte ak nimewo telefòn. Antre kòd la.
7. Pa pataje PAIRING_SECRET oswa dosye auth la.

Pou teste API a: ouvri https://ADRES-SERVIS-RENDER/health

Kòmand yo dwe teste nan yon gwoup tès. Bot la dwe admin pou efase lyen, retire manm, oswa chanje mòd gwoup la. .kickall pa ladan l pou evite retire tout manm pa erè.

Pou lanse lokalman:
- Kopi .env.example kòm .env epi ranpli valè yo.
- npm install
- npm start

Nòt: Sa se premye vèsyon k ap mache pou teste. Li poko gen dashboard sit entènèt la, ni bazdone manm EDI CLAN PORTAL la. N ap konekte yo apre bot la fin verifye.
