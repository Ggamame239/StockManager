# P.tech Stock Manager

เว็บ React/Vite สำหรับจัดการ Stock และติดตาม PO โดยแยกข้อมูลใน Cloud Firestore เป็น `inventory`, `stockLogs`, `purchaseOrders`, `poCustomers` และ `syncConflicts`

## สถานะและข้อควรทราบ

- Frontend ใช้ Firebase Anonymous Authentication อัตโนมัติ ไม่มีหน้า login
- ผู้ที่เข้าถึง URL ได้สามารถสมัคร anonymous account และอ่าน/แก้ข้อมูลทั้งสองโมดูลได้ ขอบเขต Collection แยกกันแต่ **ไม่ได้จำกัดสิทธิ์ระหว่างผู้ใช้** เหมาะกับการทดสอบหรือข้อมูลที่อนุญาตให้ผู้เข้าถึงเว็บทุกคนแก้ไข ห้ามใส่ข้อมูลลับหรือข้อมูลที่ต้องจำกัดตามผู้ใช้
- `firestore.rules` ตรวจการล็อกอิน anonymous และรูปแบบข้อมูลขั้นพื้นฐาน ไม่สามารถแยกผู้ใช้ anonymous ว่าเป็นพนักงานคนใด
- PO มี Apps Script sync source ใน `apps-script/po-tracker/` แต่ยังต้องตั้งค่าและทดสอบกับสำเนา Google Sheet ก่อน
- Stock Apps Script source และ schema `Products`/`Logs` ที่ผู้ใช้ให้มาอยู่ใน `apps-script/stock/` และแยกจาก PO แล้ว แต่ยังต้องตั้งค่าและทดสอบกับสำเนา Google Sheet ก่อน
- หน้าจอ subscribe ข้อมูล Stock และ PO ทั้ง Collection เพื่อรักษาการค้นหา/กรองเดิม ข้อมูล 10,000 รายการจะอ่านจำนวนมากเมื่อเปิดหน้าใหม่ แม้ Listener จะรับเฉพาะการเปลี่ยนแปลงภายหลัง ต้องวัดจำนวนผู้ใช้/โควตาจริงก่อน production; ประวัติ Stock จำกัดการอ่านครั้งละ 100 รายการ
- ไม่มีการ deploy, สร้าง deployment ใหม่, รัน migration หรือเขียนข้อมูลจริงจากงานพัฒนานี้
- Apps Script URLs เดิมอ่าน Sheet ได้ แต่ไม่รู้จัก action ซิงก์รุ่นปัจจุบัน; หน้าเว็บจึงตรวจ `stock_sync_health`/`po_sync_health` ก่อนเขียน และจะหยุดการบันทึกหาก deployment ยังไม่พร้อม

## ตั้งค่า Firebase ในสภาพแวดล้อมทดสอบ

ใช้ Firebase **test project** แยกจากข้อมูลจริง และสร้าง Web App, Cloud Firestore ใน Native mode แล้วดำเนินการดังนี้:

1. Firebase Console → Authentication → Sign-in method → เปิด **Anonymous**.
2. Firebase Console → Firestore Database → Rules → เผยแพร่เนื้อหาจาก `firestore.rules` ไปยัง test project เท่านั้น. สร้าง Composite Index สำหรับ `stockLogs` ตาม `firestore.indexes.json` หรือ deploy index ผ่าน Firebase CLI.
3. ตั้ง Environment Variables ตาม `.env.example`:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
4. จำกัด Firebase API key ตามเว็บไซต์ที่ใช้ทดสอบ และเปิดเฉพาะ APIs ที่จำเป็น

Firebase Web API key ไม่ใช่ private key แต่การจำกัด key ไม่ได้ทดแทน Authentication และ Firestore Rules ได้ การปิด login ในแอปนี้หมายถึงเปิดสิทธิ์ข้อมูลแก่ผู้ที่เข้า URL ได้ทั้งหมดตามที่เจ้าของโปรเจกต์ยอมรับ

Firebase จะไม่เริ่มเชื่อมต่อจนกว่าจะตั้ง Environment Variables ครบ ป้องกันการเขียนข้อมูลไป project ที่ไม่ตั้งใจ ใช้ config ของ **test project** ใน `.env`/Vercel Preview ก่อนเปิดเว็บ ห้ามทดสอบการเขียนกับ project จริงโดยไม่สำรองและอนุมัติ

ยังไม่ต้องเปิด Billing เพื่อทำงานส่วน Firebase SDK, Anonymous Auth และ Firestore เบื้องต้น แต่โควตา/บริการเสริมอาจต่างกันตามโปรเจกต์และการเปลี่ยนแปลงของ Google ให้ตรวจหน้า Usage/Billing ของ test project ก่อนทดสอบปริมาณมาก ห้ามเปิด Billing โดยไม่มีอนุมัติ

## Apps Script ไฟล์เดียวสำหรับคัดลอกวาง

สร้าง Apps Script project ใหม่แยกกันสอง project (ห้ามเอา Stock กับ PO ไว้ project เดียวกัน) แล้วเปิดไฟล์ `Code.gs` ที่ระบบสร้างไว้ เลือกเนื้อหาทั้งหมดแล้ววางทับด้วยไฟล์ที่ตรงกับ module:

- [StockManager.gs](./apps-script/ready-to-paste/StockManager.gs) — ใส่ Stock Sheet ID ใน Script Property `STOCK_SPREADSHEET_ID` ก่อนรัน
- [POTracker.gs](./apps-script/ready-to-paste/POTracker.gs) — ผูกกับ PO Sheet ID `1KGghrQJ7po1w_FElfRxznyvMc2qkW3Wv0nkO6O6a0ik`

แต่ละไฟล์รวม source `.gs` ทุกส่วนของ module นั้นแล้ว วางเป็นไฟล์ `Code.gs` ไฟล์เดียวได้ ไม่ต้องนำไฟล์จากอีก module มารวม และห้ามนำ URL `/exec` deployment เก่ามาใช้แทน deployment ใหม่

ใน **แต่ละ** Apps Script project เปิด Project Settings → Script Properties แล้วเพิ่ม:

| Property | ค่า |
|---|---|
| `FIREBASE_PROJECT_ID` | `ptechmanagerapp` |
| `FIREBASE_API_KEY` | Web API key ของ Firebase project เดียวกัน (ใส่ใน Script Properties ไม่ใช่ใน source code) |

PO Sheet ID ฝังเป็นค่าเริ่มต้นใน `.gs`; ส่วน Stock ต้องตั้ง Script Property `STOCK_SPREADSHEET_ID` จาก URL ของ Stock Sheet ที่เปิดได้จริง เพราะ ID ที่เคยส่งมาก่อนหน้าใช้เปิดด้วย `SpreadsheetApp.openById` ไม่สำเร็จ

**อย่ารัน migration ซ้ำหรือเปลี่ยนข้อมูลก่อนตรวจสำเนาและตั้ง flags ให้ครบ**: การตั้ง metadata เพิ่มคอลัมน์ที่ซ่อนไว้ใน Sheet และการ migration เขียน Firestore จริง

- Stock: ตั้ง `STOCK_ALLOW_METADATA_SETUP=YES` กับ `STOCK_SETUP_SPREADSHEET_ID` ให้ตรงกับ Stock Sheet แล้วรัน `stockSetupSyncMetadata()`. จากนั้นตั้ง `STOCK_ALLOW_SYNC=YES`, `STOCK_SYNC_SPREADSHEET_ID` ให้ตรงกัน, `STOCK_ALLOW_MIGRATION=YES`, `STOCK_MIGRATION_SPREADSHEET_ID` ให้ตรงกัน. รัน `stockMigrateBatchToFirestore()` และ `stockMigrateLogsBatchToFirestore()` ซ้ำจน `done: true`; รัน `stockMigrationAudit()` ตรวจผล.
- PO: ตั้ง `PO_ALLOW_METADATA_SETUP=YES` กับ `PO_SETUP_SPREADSHEET_ID` ให้ตรงกับ PO Sheet แล้วรัน `poSetupSyncMetadata()`. ตั้ง `PO_ALLOW_SYNC=YES`, `PO_SYNC_SPREADSHEET_ID`, `PO_ALLOW_MIGRATION=YES`, `PO_MIGRATION_SPREADSHEET_ID` ให้ตรงกับ PO Sheet. รัน `poMigrateOptionsToFirestore()`, `poMigrateCustomerBatchToFirestore()` และ `poMigrateSheetBatchToFirestore()` ซ้ำจน batch เสร็จ; รัน `poMigrationAudit()` ตรวจผล.

PO Number อนุญาตให้ซ้ำได้; Invoice Number (คอลัมน์ F เมื่อระบุ) ต้องไม่ซ้ำระหว่างรายการที่ยังไม่ลบ ส่วน Invoice ที่เว้นว่างซ้ำได้ ทั้งหน้าเว็บ, Sheet sync และ migration ใช้กติกาเดียวกัน การเปลี่ยนกติกานี้ไม่เปลี่ยน Stable Firestore ID ของรายการเดิม.

หลัง audit ผ่าน ติดตั้ง Stock triggers: `stockInstallEditTrigger()`, `stockInstallChangeTrigger()`, `stockInstallReconciliationTrigger()`; และ PO triggers: `poInstallEditTrigger()`, `poInstallChangeTrigger()`, `poInstallReconciliationTrigger()`. จากนั้น Deploy → New deployment → Web app แยกแต่ละ project, เลือก execute as เจ้าของ Script และเปิด access ที่ผู้ใช้เว็บเรียกได้ แล้วคัดลอก URL `/exec` ของแต่ละ module.

หาก migration แบบ batch เคยหยุดด้วย `Unknown name "updateMask" at 'writes[0].update'` ให้วาง/บันทึก `firebaseSync.gs` ฉบับล่าสุด (หรือ `.gs` ไฟล์เดียวฉบับล่าสุด) ใน Apps Script project เดิม แล้วเรียก batch function ที่หยุดนั้นซ้ำได้ เพราะ cursor จะเลื่อนไปหลัง Firestore commit สำเร็จเท่านั้น; จากนั้นตรวจด้วย migration audit.

ใส่ URLs ใหม่ใน `.env.local` สำหรับ proxy ระหว่างพัฒนาในเครื่อง:

```dotenv
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/NEW_STOCK_DEPLOYMENT_ID/exec
VITE_PO_APPS_SCRIPT_URL=https://script.google.com/macros/s/NEW_PO_DEPLOYMENT_ID/exec
```

รีสตาร์ต Vite หลังเปลี่ยน env. สำหรับ Vercel ให้ตั้งตัวแปร Firebase ที่ขึ้นต้น `VITE_FIREBASE_` ตาม `.env.example` และตั้ง URL ฝั่ง server ต่อไปนี้ โดยเลือก Production/Preview ตาม deployment ที่ต้องการ:

| Vercel Environment Variable | ค่า |
|---|---|
| `STOCK_APPS_SCRIPT_URL` | `/exec` URL ของ Stock Web App |
| `PO_APPS_SCRIPT_URL` | `/exec` URL ของ PO Tracker Web App |

อย่าตั้ง URL ของ Apps Script เป็น `VITE_...` บน Vercel; API จะวิ่งผ่าน `/api/stock-sync` และ `/api/po-sync` ซึ่งเป็น Vercel Functions เพื่อหลีกเลี่ยง CORS และแยก URL ออกจาก JavaScript ที่ส่งให้ browser. จากนั้น redeploy เพื่อให้ functions อ่าน Environment Variables. Health check ของแต่ละ Apps Script จะตรวจความพร้อมก่อนการเขียนข้อมูล

### ตั้งค่า Vercel project

1. ใน Vercel Dashboard เลือก **Add New → Project** แล้ว Import repository `Ggamame239/StockManager`.
2. ตั้ง Framework Preset เป็น **Vite**, Build Command เป็น `npm run build`, Output Directory เป็น `dist` และ Root Directory เป็น repository root.
3. เพิ่ม Environment Variables ตามตารางข้างบนและกำหนด Environment ให้ตรงกับ deployment ที่จะทดสอบ; Production ต้องชี้ Firebase/Apps Script production ที่ได้รับอนุมัติ ส่วน Preview ควรชี้ test project/test Sheet.
4. Deploy หลังตรวจค่าทั้งหมดแล้ว. การ Deploy, ผูก GitHub repository และตั้งค่า Environment Variables ต้องทำใน Vercel account ของเจ้าของ project; อย่าเปิด Billing/อัปเกรดแผนเพื่อแก้ quota โดยไม่ได้รับอนุญาต.
5. หลัง Deploy ทดสอบเปิดเว็บ, โหลด Stock/PO, health check และบันทึกข้อมูลทดสอบที่ได้รับอนุมัติ จากนั้นดู **Functions** และ **Usage** ใน Vercel. Proxy จำกัด request body ที่ 4 MB; รูปภาพสินค้าที่อัปโหลดผ่านแอปต้องไม่เกินขีดจำกัดนี้.

## เตรียมเปิดใช้จริงหลังสำรองข้อมูล

การอ่าน Sheet แบบตรวจสอบล่าสุดพบ Stock 13 รายการ และ PO 14 รายการ แต่ข้อมูล PO จาก deployment เดิมไม่มี Stable ID และ deployment ทั้งสองไม่รองรับ sync action ปัจจุบัน จึงต้องติดตั้ง source รุ่นนี้เป็น **Apps Script deployment ใหม่แยกสำหรับ Stock และ PO** ห้ามแก้ทับ deployment เดิม:

1. ทำสำเนา/สำรอง Stock และ PO Sheets แล้วตรวจว่า Script Properties ของ Stock ชี้ไป Stock Sheet และของ PO ชี้ไป PO Sheet เท่านั้น
2. สร้าง Apps Script project แยก 2 ชุดจาก `apps-script/stock/` และ `apps-script/po-tracker/`; ตั้งค่า Spreadsheet ID, `FIREBASE_PROJECT_ID=ptechmanagerapp`, `FIREBASE_API_KEY` และ approval flags ตามหัวข้อของแต่ละโมดูลด้านล่าง
3. ติดตั้ง metadata บน Sheet เพื่อผูก Stable ID (PO metadata setup เพิ่มคอลัมน์ที่ซ่อนใน PO tracker และ Sheet1; Stock เพิ่มใน Products) จากนั้นรัน batch migration เข้าสู่ Firestore
4. รัน migration audit ก่อนเปิดใช้ ต้องตรวจรายการขาด/เกิน/ไม่ตรงกันและจำนวนซ้ำให้เรียบร้อย โดยข้อมูลเดิมใน Sheet จะไม่ถูกลบ
5. ติดตั้ง edit/change/reconciliation triggers และสร้าง Web App deployment ใหม่ของแต่ละ project โดยตั้งให้ execute as เจ้าของ Script และตั้ง access ให้ผู้ใช้เว็บเรียกได้
6. ใส่ URL ของ deployment ใหม่ใน `.env.local` (`VITE_APPS_SCRIPT_URL`, `VITE_PO_APPS_SCRIPT_URL`) สำหรับ local และใน Vercel Server Environment Variables (`STOCK_APPS_SCRIPT_URL`, `PO_APPS_SCRIPT_URL`) สำหรับ Production/Preview แล้ว redeploy
7. ตรวจ endpoint readiness และทดสอบเว็บ → Firestore → Sheet กับรายการทดสอบที่อนุมัติก่อนประกาศพร้อมใช้งาน

ห้ามเปิด flags สำหรับ migration/sync จนยืนยัน Sheet ID ถูกต้องและสำรองข้อมูลแล้ว การ migration เขียน Firestore และ metadata ใน Sheet; การเผยแพร่ deployment/Rules เป็นการเปลี่ยนระบบจริง ส่วนนี้ต้องทำโดยผู้มีสิทธิ์ใน Google/Firebase Console และไม่ควรนำ URL เดิมมาใช้เพียงเพราะยังอ่านข้อมูลได้

## PO Tracker Apps Script สำหรับ test

ไฟล์ใน `apps-script/po-tracker/` เป็น source สำหรับ **Apps Script project ของ PO แยกต่างหาก** ห้ามนำไปรวมกับ Stock project:

- `doPost.gs`
- `poTracker.gs`
- `firebaseSync.gs`
- `appsscript.json`

ก่อนติดตั้งจริงต้องทำสำเนา PO Google Sheet และใช้ ID ของสำเนาใน Script Properties:

| Script Property | ค่า |
|---|---|
| `PO_SPREADSHEET_ID` | ID ของ Google Sheet สำเนาทดสอบ |
| `FIREBASE_PROJECT_ID` | Firebase test project ID |
| `FIREBASE_API_KEY` | Firebase Web API key ของ test project |
| `PO_ALLOW_METADATA_SETUP` | ตั้ง `YES` หลังยืนยันว่าเป็นสำเนาทดสอบ |
| `PO_SETUP_SPREADSHEET_ID` | ต้องตรงกับ ID ของสำเนาทดสอบ ก่อนเรียกตั้ง metadata |

ขั้นตอนทดสอบที่ต้องทำด้วยผู้มีสิทธิ์ใน Google/Firebase:

1. วางไฟล์ PO Script ใน Apps Script project แยก และตรวจ OAuth scopes ใน `appsscript.json`.
2. บันทึก Script Properties ตามตาราง แล้วอนุญาต scopes ที่ Apps Script ขอ
3. เรียก `poSetupSyncMetadata()` บนสำเนา Sheet เพื่อเพิ่ม metadata ในคอลัมน์ว่างถัดจากข้อมูลเดิม (ID, tombstone, revision และ hash จะถูกซ่อนไว้)
4. ก่อนเปิด sync ให้ตั้ง `PO_ALLOW_SYNC=YES` และ `PO_SYNC_SPREADSHEET_ID` ให้ตรงกับ ID สำเนาทดสอบ จากนั้นเรียก `poMigrateOptionsToFirestore()` หนึ่งครั้ง
5. ใน Script Properties ให้ตั้ง `PO_ALLOW_MIGRATION=YES` และ `PO_MIGRATION_SPREADSHEET_ID` ให้ตรงกับ ID สำเนาที่อนุมัติ ก่อนเรียก `poMigrateCustomerBatchToFirestore()` และ `poMigrateSheetBatchToFirestore()` ซ้ำจนแต่ละฟังก์ชันรายงาน `done: true`
6. เรียก `poMigrationAudit()` เพื่อตรวจจำนวนและความตรงกันของ PO/Customer จากนั้นเปรียบเทียบข้อมูลสำคัญก่อนทดสอบแก้ไข
7. ติดตั้ง `poInstallEditTrigger()`, `poInstallChangeTrigger()` และ `poInstallReconciliationTrigger()` บน project ทดสอบ การตรวจ reconciliation ทำครั้งละ 50 แถวทุก 15 นาที; การแก้ Sheet ปกติใช้ installable edit trigger
8. สร้าง **test web-app deployment ใหม่** สำหรับ PO Script และใช้ URL ทดสอบเป็น `VITE_PO_APPS_SCRIPT_URL` ใน local `.env.local` หรือ `PO_APPS_SCRIPT_URL` ใน Vercel Preview เท่านั้น การสร้าง/เผยแพร่ deployment จริงยังต้องได้รับอนุมัติก่อน

ห้ามตั้ง `PO_MIGRATION_SPREADSHEET_ID` เป็น Sheet จริง หรือเปิด migration จนกว่าจะสำรองข้อมูลและได้รับอนุมัติ การ migration ทำเป็นชุดละ 200 รายการและบันทึก cursor เพื่อรันต่อได้; ไม่ลบข้อมูลต้นทาง

การแก้ PO จากหน้าเว็บเขียน Firestore ก่อน แล้วเรียก Apps Script action `po_sync_from_firestore`/`po_sync_customer_from_firestore` เพื่อซิงก์ไปยังชีต หาก Apps Script sync ล้มเหลว ข้อมูลใน Firestore ยังอยู่และหน้าเว็บแสดงข้อผิดพลาดพร้อมสถานะซิงก์ที่ล้มเหลว การแก้จาก Sheet ส่งกลับ Firestore ด้วย installable trigger และมี reconciliation สำหรับตรวจแถวที่พลาด

เพิ่ม Script Properties สำหรับ sync เฉพาะสำเนาทดสอบ:

| Script Property | ค่า |
|---|---|
| `PO_ALLOW_SYNC` | `YES` หลังอนุมัติ sync |
| `PO_SYNC_SPREADSHEET_ID` | ต้องตรงกับ `PO_SPREADSHEET_ID` |
| `PO_ALLOW_MIGRATION` | `YES` เฉพาะช่วง migration ที่อนุมัติ |
| `PO_MIGRATION_SPREADSHEET_ID` | ต้องตรงกับ `PO_SPREADSHEET_ID` |

เว็บลบ PO ด้วย tombstone; การลบแถวทั้งแถวจาก Sheet ตรวจผ่าน installable change trigger หลัง migration ครบเท่านั้น ส่วนการล้างช่องข้อมูลโดยไม่ลบแถวจะใช้คอลัมน์ ID ที่ซ่อนไว้เพื่อสร้าง tombstone

## Stock Apps Script สำหรับ test

ไฟล์ใน `apps-script/stock/` เป็น project แยกของ Stock:

- `Code.gs` — Products/Logs, Drive image upload และการตรวจสอบข้อมูลจาก Stock source ที่ผู้ใช้ให้มา
- `doPost.gs` — Stock API dispatcher เท่านั้น
- `stockSync.gs` — Stable ID, tombstone, revision/hash, edit trigger, reconciliation, batch migration และ audit
- `firebaseSync.gs` — Firestore REST/anonymous token สำหรับ Apps Script project นี้
- `appsscript.json` — scopes ของ Apps Script

ใช้ **สำเนา Stock Google Sheet** และ test Firebase project เท่านั้น:

| Script Property | ค่า |
|---|---|
| `STOCK_SPREADSHEET_ID` | ID ของ Stock Google Sheet สำเนาทดสอบ |
| `FIREBASE_PROJECT_ID` | Firebase test project ID |
| `FIREBASE_API_KEY` | Firebase Web API key ของ test project |
| `STOCK_ALLOW_SETUP` | `YES` เฉพาะก่อนเรียก `setup()` |
| `STOCK_SETUP_SPREADSHEET_ID` | ต้องตรงกับ Stock Sheet สำเนาทดสอบ |
| `STOCK_ALLOW_METADATA_SETUP` | `YES` เฉพาะก่อนเรียก `stockSetupSyncMetadata()` |
| `STOCK_ALLOW_SYNC` | `YES` หลังอนุมัติเริ่ม sync |
| `STOCK_SYNC_SPREADSHEET_ID` | ต้องตรงกับ `STOCK_SPREADSHEET_ID` |
| `STOCK_ALLOW_MIGRATION` | `YES` เฉพาะช่วง migration ที่อนุมัติ |
| `STOCK_MIGRATION_SPREADSHEET_ID` | ต้องตรงกับ `STOCK_SPREADSHEET_ID` |

ตั้งค่าและทดสอบตามลำดับ:

1. สร้าง Apps Script project แยกสำหรับ Stock จากสำเนา Sheet และเพิ่มไฟล์ในโฟลเดอร์นี้ ตรวจ `appsscript.json` scopes และอนุญาต Google prompts ด้วยผู้มีสิทธิ์
2. ตั้ง properties สำหรับ Sheet/Firebase/test และ `STOCK_ALLOW_SETUP=YES` พร้อม `STOCK_SETUP_SPREADSHEET_ID` ให้ตรงกัน จากนั้นเรียก `setup()` บนสำเนาเท่านั้น
3. เปลี่ยนเป็น `STOCK_ALLOW_METADATA_SETUP=YES` และใช้ `STOCK_SETUP_SPREADSHEET_ID` เดิม เรียก `stockSetupSyncMetadata()` เพื่อเพิ่มคอลัมน์ที่ซ่อนถัดจาก schema เดิม
4. ตั้ง `STOCK_ALLOW_SYNC=YES` และ `STOCK_SYNC_SPREADSHEET_ID` ให้ตรงกัน เปิด sync แล้วติดตั้ง `stockInstallEditTrigger()`, `stockInstallChangeTrigger()` และ `stockInstallReconciliationTrigger()`
5. ตั้ง migration flags/ID แล้วเรียก `stockMigrateBatchToFirestore()` และ `stockMigrateLogsBatchToFirestore()` ซ้ำจน `done: true`; ตรวจ `stockMigrationAudit()` ก่อนทดสอบสองทาง
6. สร้าง **test deployment ใหม่** จาก Stock Apps Script project นี้ ตั้ง URL ของ test deployment เป็น `VITE_APPS_SCRIPT_URL` ใน local `.env.local` หรือ `STOCK_APPS_SCRIPT_URL` ใน Vercel Preview และทดสอบเว็บ → Sheet, Sheet → Firestore, edit, adjust, tombstone, logs และ retry

Migration ทำทีละ 200 แถว เก็บ cursor และไม่ลบข้อมูลต้นทาง การตรวจ row ที่ลบออกจาก Products จะทำเมื่อมี event ลบแถวและหลัง migration สินค้าเสร็จเท่านั้น การเปลี่ยนแปลงปกติตรวจทีละ 50 แถวทุก 15 นาที ไม่มีการเรียก Apps Script APIs, ตั้งค่า Script Properties, เพิ่มคอลัมน์, trigger, deployment หรือ migration จริงจากการแก้โค้ดนี้

## รันและตรวจโค้ด

```sh
npm install
npm run lint
npm run build
```

คำสั่งเหล่านี้ตรวจเฉพาะ React/Vite ไม่ได้ยืนยัน Firebase Rules, OAuth, Google Sheets trigger, Apps Script deployment, quota หรือการซิงก์กับข้อมูลจริง ต้องทดสอบทั้งหมดใน test project และสำเนา Sheet ก่อน Preview/Production
