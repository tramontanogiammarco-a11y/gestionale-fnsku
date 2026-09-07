# Aimago WMS per iOS

## Stato

Il repository contiene un progetto iOS Capacitor in `frontend/ios/`. L'app include il frontend compilato, apre direttamente l'area operativa `/wms-app` per admin e operatori e usa lo scanner barcode nativo su iPhone. La versione web continua a usare ZXing.

Bundle ID: `com.aimago.logistics.wms`

Versione minima: iOS 15

## Prerequisiti Mac

- Xcode 26 o successivo con iOS 26 SDK.
- Account Apple Developer collegato a Xcode.
- Team, certificato di distribuzione e profilo di provisioning per il bundle ID.
- Un iPhone fisico per verificare scanner, torcia, feedback aptico e comportamento con rete instabile.

## Sincronizzazione

Eseguire dalla cartella `frontend`:

```bash
npm install --legacy-peer-deps
npm run ios:sync
npm run ios:open
```

`ios:sync` ricompila React e copia il risultato nel progetto iOS. Va eseguito dopo ogni modifica frontend o aggiornamento dei plugin Capacitor.

## Prima prova su iPhone

1. Aprire `frontend/ios/App/App.xcodeproj` con Xcode tramite `npm run ios:open`.
2. Selezionare il target `App`, aprire `Signing & Capabilities` e scegliere il Team Aimago.
3. Verificare che il bundle ID sia disponibile per il Team.
4. Collegare l'iPhone, autorizzare il Mac e selezionarlo come destinazione.
5. Eseguire l'app e concedere il permesso Fotocamera.
6. Provare login, scanner universale, picking Galluse, picking massivo, refill e packing remoto.

## TestFlight

1. In Xcode aggiornare `Marketing Version` e `Current Project Version`.
2. Selezionare `Any iOS Device (arm64)` e creare l'archivio con `Product > Archive`.
3. Da Organizer eseguire `Distribute App > App Store Connect > Upload`.
4. In App Store Connect compilare privacy, categoria, contatti, screenshot e note per la revisione.
5. Pubblicare prima per tester interni e completare un ciclo operativo reale prima della revisione App Store.

## Verifiche obbligatorie

- La scansione annullata non deve generare errori o scansioni duplicate.
- Una perdita di rete deve essere segnalata e non deve lasciare missioni in stato ambiguo.
- Le operazioni stock restano lato Supabase/RPC: il contenitore iOS non modifica le regole di transazione o RLS.
- Login e sessione devono essere verificati dopo chiusura completa, riavvio e aggiornamento dell'app.
- Il layout deve rispettare status bar e home indicator su iPhone con e senza Dynamic Island.
- L'app deve essere provata con scanner rapido su slot, pallet, prodotti, bag, carrelli ed etichette corriere.

## Limiti correnti

- Il progetto non puo essere compilato o firmato senza Xcode completo.
- Il lavoro offline delle missioni non e incluso: l'app richiede connessione a Supabase.
- Prima della produzione va eseguito un test end-to-end su dispositivo fisico e un audit delle operazioni stock concorrenti.
