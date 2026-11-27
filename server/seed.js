// Stammdaten (Vorlagen, Kurse, Anleitungen) und eindeutig fiktive Demo-Daten.
// Keine echten Mitarbeiter, keine Rezepturen, keine erfundenen Grenzwerte oder Geräteverfahren.
// Übersetzungen EN/AR/TR sind Entwürfe: reviewed_langs = 'de' -> App zeigt "Übersetzung nicht geprüft".
import { tx } from './db.js';
import { hashPassword } from './auth.js';
import { EXTRA_COURSES } from './courses-extra.js';
import { DAILY_ITEMS } from './handbook.js';
import { seedTraining } from './training.js';
import { seedControls } from './controls.js';

const L = (de, en, ar, tr) => ({ de, en, ar, tr });

// [shift, category, icon, title, hint, options]
const TEMPLATES = [
  // Öffnung / Frühschicht
  ['open', 'routine', 'light', L('Licht einschalten', 'Switch on the lights', 'شغّل الإضاءة', 'Işıkları aç'),
    L('Küche, Theke und Gastraum.', 'Kitchen, counter and dining room.', 'المطبخ والكاونتر وصالة الزبائن.', 'Mutfak, tezgâh ve salon.')],
  ['open', 'routine', 'eye', L('Rundgang: alles in Ordnung?', 'Walk-round: is everything OK?', 'جولة: هل كل شيء سليم؟', 'Tur: her şey yolunda mı?'),
    L('Schäden, Schmutz, Schädlinge? Dann Problem melden.', 'Damage, dirt, pests? Then report a problem.', 'أضرار أو أوساخ أو حشرات؟ أبلغ عن مشكلة.', 'Hasar, kir, haşere? Sorun bildir.'), { photo: 1 }],
  ['open', 'hygiene', 'hands', L('Hände waschen', 'Wash your hands', 'اغسل يديك', 'Ellerini yıka'),
    L('Mit Seife waschen, gut abtrocknen.', 'Use soap, dry well.', 'بالصابون، ثم جفّفهما جيدًا.', 'Sabunla yıka, iyice kurula.'), { sop: 'SOP-HANDS' }],
  ['open', 'haccp', 'snow', L('Kühlschrank: Temperatur ablesen', 'Fridge: read the temperature', 'الثلاجة: اقرأ درجة الحرارة', 'Buzdolabı: sıcaklığı oku'),
    L('Wert eintragen. Foto vom Thermometer.', 'Enter the value. Photo of the thermometer.', 'أدخل القيمة. صوّر الميزان.', 'Değeri gir. Termometrenin fotoğrafı.'), { photo: 1, unit: '°C' }],
  ['open', 'haccp', 'snow', L('Tiefkühler: Temperatur ablesen', 'Freezer: read the temperature', 'المجمّد: اقرأ درجة الحرارة', 'Derin dondurucu: sıcaklığı oku'),
    L('Wert eintragen. Foto vom Thermometer.', 'Enter the value. Photo of the thermometer.', 'أدخل القيمة. صوّر الميزان.', 'Değeri gir. Termometrenin fotoğrafı.'), { photo: 1, unit: '°C' }],
  ['open', 'equipment', 'fryer', L('Fritteuse bereit machen', 'Get the fryer ready', 'جهّز القلاية', 'Fritözü hazırla'),
    L('Nur mit Freigabe. Nach Anleitung des Herstellers.', 'Only if you are approved. Follow the manufacturer manual.', 'فقط بعد الإذن. حسب دليل الشركة المصنّعة.', 'Sadece onaylıysan. Üretici kılavuzuna göre.'), { sop: 'SOP-FRYER-GGM', course: 'C-FRYER-GGM', station: 'druckfritteuse' }],
  ['open', 'goods', 'box', L('Ware prüfen', 'Check stock', 'افحص البضاعة', 'Malları kontrol et'),
    L('Haltbarkeit ansehen. Abgelaufenes melden.', 'Look at best-before dates. Report expired items.', 'انظر إلى تاريخ الصلاحية. أبلغ عن المنتهي.', 'Son kullanma tarihlerine bak. Süresi geçeni bildir.')],
  ['open', 'routine', 'prep', L('Arbeitsplatz vorbereiten', 'Prepare your workstation', 'جهّز مكان العمل', 'Çalışma yerini hazırla'),
    L('Sauber, aufgeräumt, alles griffbereit.', 'Clean, tidy, everything at hand.', 'نظيف ومرتب وكل شيء في متناول اليد.', 'Temiz, düzenli, her şey elinin altında.'), { station: 'panieren' }],
  ['open', 'routine', 'store', L('Theke vorbereiten', 'Prepare the counter', 'جهّز الكاونتر', 'Tezgâhı hazırla'),
    L('Theke sauber, Bildschirme an, Tüten bereit.', 'Counter clean, screens on, bags ready.', 'الكاونتر نظيف والشاشات تعمل والأكياس جاهزة.', 'Tezgâh temiz, ekranlar açık, poşetler hazır.'), { station: 'theke' }],
  ['open', 'routine', 'fryer', L('Pommes-Station vorbereiten', 'Prepare the fries station', 'جهّز محطة البطاطا', 'Patates istasyonunu hazırla'),
    L('Körbe, Salz, Schaufel, Tüten bereit.', 'Baskets, salt, scoop, bags ready.', 'السلال والملح والمغرفة والأكياس جاهزة.', 'Sepetler, tuz, kepçe, poşetler hazır.'), { station: 'pommes' }],
  // Laufender Betrieb
  ['run', 'hygiene', 'hands', L('Hände waschen', 'Wash your hands', 'اغسل يديك', 'Ellerini yıka'),
    L('Nach rohem Fleisch, Müll und Pause.', 'After raw meat, rubbish and breaks.', 'بعد اللحم النيء والقمامة والاستراحة.', 'Çiğ etten, çöpten ve moladan sonra.'), { sop: 'SOP-HANDS' }],
  ['run', 'hygiene', 'shield', L('Roh und fertig trennen', 'Keep raw and cooked apart', 'افصل النيء عن المطبوخ', 'Çiğ ve pişmişi ayır'),
    L('Eigene Bretter und Zangen benutzen.', 'Use separate boards and tongs.', 'استخدم ألواحًا وملاقط منفصلة.', 'Ayrı tahta ve maşa kullan.'), { station: 'panieren' }],
  ['run', 'cleaning', 'spray', L('Flächen reinigen', 'Clean surfaces', 'نظّف الأسطح', 'Yüzeyleri temizle'),
    L('Reinigungsmittel laut Etikett benutzen.', 'Use cleaning product as on the label.', 'استخدم المنظّف حسب الملصق.', 'Temizlik ürününü etikete göre kullan.'), { sop: 'SOP-SURFACES' }],
  ['run', 'routine', 'refill', L('Nachfüllen', 'Refill', 'أعد التعبئة', 'Doldur'),
    L('Verpackung, Saucen, Servietten.', 'Packaging, sauces, napkins.', 'العبوات والصلصات والمناديل.', 'Ambalaj, soslar, peçeteler.'), { station: 'ausgabe' }],
  ['run', 'equipment', 'oil', L('Tägliche Ölprüfung (alle Fritteusen)', 'Daily oil check (all fryers)', 'فحص الزيت اليومي (كل القلايات)', 'Günlük yağ kontrolü (tüm fritözler)'),
    L('Jede Fritteuse im Ölmanager prüfen: TPM, Temperatur, zulässig? Foto.', 'Check every fryer in the oil manager: TPM, temperature, OK? Photo.', 'افحص كل قلاية في إدارة الزيت: TPM، الحرارة، مقبول؟ صورة.', 'Her fritözü yağ yöneticisinde kontrol et: TPM, sıcaklık, uygun mu? Fotoğraf.'), { course: 'C-FRYER-GGM', station: 'druckfritteuse', action: 'oil_check' }],
  // Schließung / Spätschicht
  ['close', 'cleaning', 'fryer', L('Pommes-Station reinigen', 'Clean the fries station', 'نظّف محطة البطاطا', 'Patates istasyonunu temizle'),
    L('Nach freigegebener Anleitung. Foto am Ende.', 'As per approved instructions. Photo at the end.', 'حسب التعليمات المعتمدة. صورة في النهاية.', 'Onaylı talimata göre. Sonunda fotoğraf.'), { photo: 1, station: 'pommes' }],
  ['close', 'cleaning', 'prep', L('Panierstation reinigen', 'Clean the breading station', 'نظّف محطة التغليف', 'Pane istasyonunu temizle'),
    L('Reste weg, Behälter spülen, Fläche desinfizieren.', 'Remove leftovers, wash containers, disinfect surface.', 'أزل البقايا واغسل الأوعية وعقّم السطح.', 'Artıkları at, kapları yıka, yüzeyi dezenfekte et.'), { photo: 1, station: 'panieren', sop: 'SOP-SURFACES' }],
  ['close', 'goods', 'box', L('Restware richtig lagern', 'Store leftovers correctly', 'خزّن البقايا بشكل صحيح', 'Kalanları doğru sakla'),
    L('Abdecken, beschriften, kühlen. Sonst entsorgen.', 'Cover, label, chill. Otherwise throw away.', 'غطِّ وضع ملصقًا وبرّد. وإلا فتخلّص منها.', 'Ört, etiketle, soğut. Yoksa at.')],
  ['close', 'cleaning', 'clean', L('Küche reinigen', 'Clean the kitchen', 'نظّف المطبخ', 'Mutfağı temizle'),
    L('Flächen, Boden, Abflüsse. Foto am Ende.', 'Surfaces, floor, drains. Photo at the end.', 'الأسطح والأرضية والمصارف. صورة في النهاية.', 'Yüzeyler, zemin, giderler. Sonunda fotoğraf.'), { photo: 1, sop: 'SOP-SURFACES' }],
  ['close', 'routine', 'trash', L('Müll rausbringen', 'Take out the rubbish', 'أخرج القمامة', 'Çöpü çıkar'),
    L('Danach Hände waschen.', 'Wash your hands afterwards.', 'اغسل يديك بعدها.', 'Sonra ellerini yıka.')],
  ['close', 'equipment', 'power', L('Geräte abschalten', 'Switch off equipment', 'أطفئ الأجهزة', 'Cihazları kapat'),
    L('Nur nach Anleitung. Kühlung bleibt AN!', 'Only as instructed. Refrigeration stays ON!', 'حسب التعليمات فقط. التبريد يبقى يعمل!', 'Sadece talimata göre. Soğutma AÇIK kalır!'), { photo: 1, sop: 'SOP-SHUTDOWN' }],
  ['close', 'routine', 'lightOff', L('Licht ausschalten', 'Switch off the lights', 'أطفئ الإضاءة', 'Işıkları kapat'),
    L('Notbeleuchtung nicht ausschalten.', 'Do not switch off emergency lights.', 'لا تطفئ إضاءة الطوارئ.', 'Acil durum ışıklarını kapatma.')],
  ['close', 'safety', 'door', L('Türen abschließen', 'Lock the doors', 'أقفل الأبواب', 'Kapıları kilitle'),
    L('Alle Türen und Fenster prüfen.', 'Check all doors and windows.', 'تحقّق من كل الأبواب والنوافذ.', 'Tüm kapı ve pencereleri kontrol et.'), { photo: 1, role: 'shift_lead' }],
  ['close', 'safety', 'shield', L('Abschlusskontrolle', 'Final check', 'الفحص النهائي', 'Son kontrol'),
    L('Rundgang: alles sauber, Kühlung an, Geräte aus, Müll weg. Foto.', 'Walk-round: all clean, refrigeration on, equipment off, rubbish out. Photo.', 'جولة: كل شيء نظيف، التبريد يعمل، الأجهزة مطفأة، القمامة خارجًا. صورة.', 'Tur: her yer temiz, soğutma açık, cihazlar kapalı, çöp dışarıda. Fotoğraf.'), { photo: 1, role: 'shift_lead' }],
  ['close', 'goods', 'box', L('Wöchentliche Inventur', 'Weekly stock count', 'الجرد الأسبوعي', 'Haftalık sayım'),
    L('Alle Artikel zählen – auch Saucen und Marinaden, die nicht täglich gezählt werden – und Inventur abschließen.', 'Count all items – including sauces and marinades, which are not counted daily – and complete the stock count.', 'عدّ كل الأصناف – بما فيها الصلصات والتتبيلات التي لا تُعدّ يوميًا – وأنهِ الجرد.', 'Tüm ürünleri say – günlük sayılmayan soslar ve marinatlar dahil – ve sayımı tamamla.'), { freq: 'weekly', weekdays: '1', role: 'shift_lead', link: 'inventory' }],
  ['run', 'routine', 'prep', L('Fleisch marinieren (Frühschicht)', 'Marinate meat (early shift)', 'تتبيل اللحم (الوردية الصباحية)', 'Et marine et (sabah vardiyası)'),
    L('Nach freigegebener Rezeptur marinieren und die Charge im Marinierprotokoll eintragen.', 'Marinate by the approved recipe and log the batch in the marinade protocol.', 'تبّل حسب الوصفة المعتمدة وسجّل الدفعة في بروتوكول التتبيل.', 'Onaylı tarife göre marine et ve partiyi marine protokolüne kaydet.'), { action: 'marinade' }],
  ['close', 'routine', 'prep', L('Fleisch marinieren (Spätschicht)', 'Marinate meat (late shift)', 'تتبيل اللحم (الوردية المسائية)', 'Et marine et (akşam vardiyası)'),
    L('Nach freigegebener Rezeptur marinieren und die Charge im Marinierprotokoll eintragen.', 'Marinate by the approved recipe and log the batch in the marinade protocol.', 'تبّل حسب الوصفة المعتمدة وسجّل الدفعة في بروتوكول التتبيل.', 'Onaylı tarife göre marine et ve partiyi marine protokolüne kaydet.'), { action: 'marinade' }],
  ['run', 'goods', 'scan', L('Wareneingang der Woche prüfen', 'Check this week’s goods receipts', 'مراجعة استلام البضاعة لهذا الأسبوع', 'Haftanın mal kabulünü kontrol et'),
    L('Alle Lieferungen der Woche mit Lieferschein in der App erfasst? Fehlende Lieferungen nachbuchen, Abweichungen melden.', 'All deliveries this week recorded in the app with delivery note? Book missing ones, report deviations.', 'هل سُجّلت كل توريدات الأسبوع في التطبيق مع إشعار التسليم؟ سجّل الناقص وأبلغ عن الانحرافات.', 'Haftanın tüm teslimatları irsaliyeyle uygulamaya girildi mi? Eksikleri gir, sapmaları bildir.'), { freq: 'weekly', weekdays: '1', role: 'shift_lead', action: 'goods' }],
  ['run', 'goods', 'box', L('Tagesinventur Frühschicht (bis 17:00)', 'Daily stock count early shift (by 17:00)', 'جرد يومي للوردية الصباحية (حتى 17:00)', 'Sabah vardiyası günlük sayım (17:00\'a kadar)'),
    L('Liste unter Ware → Tagesinventur ausfüllen.', 'Fill in the list under Goods → Daily count.', 'املأ القائمة في البضاعة ← الجرد اليومي.', 'Mal → Günlük sayım listesini doldur.'), { action: 'daily_early' }],
  ['close', 'goods', 'box', L('Tagesinventur Spätschicht (bis 23:00)', 'Daily stock count late shift (by 23:00)', 'جرد يومي للوردية المسائية (حتى 23:00)', 'Akşam vardiyası günlük sayım (23:00\'e kadar)'),
    L('Liste unter Ware → Tagesinventur ausfüllen.', 'Fill in the list under Goods → Daily count.', 'املأ القائمة في البضاعة ← الجرد اليومي.', 'Mal → Günlük sayım listesini doldur.'), { action: 'daily_late' }],
  ['run', 'goods', 'box', L('Lager: älteste Ware nach vorne (wöchentlich)', 'Storage: oldest stock to the front (weekly)', 'المخزن: الأقدم إلى الأمام (أسبوعيًا)', 'Depo: en eski mal öne (haftalık)'),
    L('Nach MHD sortieren. Abgelaufenes melden.', 'Sort by best-before date. Report expired items.', 'رتّب حسب تاريخ الصلاحية. أبلغ عن المنتهي.', "TETT'ye göre sırala. Süresi geçeni bildir."), { freq: 'weekly', weekdays: '3' }],
  // Wöchentlich / monatlich
  ['close', 'cleaning', 'snow', L('Kühlschrank innen reinigen (wöchentlich)', 'Clean fridge inside (weekly)', 'نظّف الثلاجة من الداخل (أسبوعيًا)', 'Buzdolabı içini temizle (haftalık)'),
    L('Ware umlagern, kühl halten.', 'Move stock, keep it cold.', 'انقل البضاعة وأبقها باردة.', 'Malları taşı, soğuk tut.'), { photo: 1, freq: 'weekly', weekdays: '1', carry: 1 }],
  ['open', 'pest', 'bug', L('Schädlingskontrolle (wöchentlich)', 'Pest check (weekly)', 'فحص الحشرات (أسبوعيًا)', 'Haşere kontrolü (haftalık)'),
    L('Kontrollpunkte ansehen. Nichts selbst sprühen.', 'Look at check points. Do not spray yourself.', 'افحص نقاط المراقبة. لا ترشّ بنفسك.', 'Kontrol noktalarına bak. Kendin ilaçlama.'), { freq: 'weekly', weekdays: '3', role: 'shift_lead', action: 'pest_check', carry: 1 }],
  ['open', 'maintenance', 'build', L('Geräte-Sichtprüfung (monatlich)', 'Equipment visual check (monthly)', 'فحص بصري للأجهزة (شهريًا)', 'Cihaz gözle kontrol (aylık)'),
    L('Kabel, Dichtungen, Typenschild. Schäden melden.', 'Cables, seals, rating plate. Report damage.', 'الأسلاك والحشوات ولوحة البيانات. أبلغ عن الأضرار.', 'Kablolar, contalar, etiket. Hasarı bildir.'), { photo: 1, freq: 'monthly', monthDay: 1, role: 'shift_lead', carry: 1 }],

  // Reinigungsplan (Betreiber-Auftrag): täglich / laufend / Schichtende; wöchentliche Grundreinigung (übertragbar, bis erledigt)
  ['run', 'cleaning', 'hands', L('Türgriffe reinigen', 'Clean door handles', 'نظّف مقابض الأبواب', 'Kapı kollarını temizle'),
    L('Griffe innen und außen, Toilettentür.', 'Handles inside and outside, toilet door.', 'المقابض من الداخل والخارج، باب الحمام.', 'Kollar içte ve dışta, tuvalet kapısı.')],
  ['run', 'cleaning', 'clean', L('Toiletten prüfen und reinigen', 'Check and clean toilets', 'افحص ونظّف الحمامات', 'Tuvaletleri kontrol et ve temizle'),
    L('Seife, Papier, Sauberkeit. Foto.', 'Soap, paper, cleanliness. Photo.', 'صابون، ورق، نظافة. صورة.', 'Sabun, kâğıt, temizlik. Fotoğraf.'), { photo: 1 }],
  ['run', 'cleaning', 'store', L('Tische und Stühle abwischen', 'Wipe tables and chairs', 'امسح الطاولات والكراسي', 'Masa ve sandalyeleri sil'),
    L('Nach Gästen, laut Reinigungsplan.', 'After guests, as per cleaning plan.', 'بعد الزبائن، حسب خطة التنظيف.', 'Misafirlerden sonra, temizlik planına göre.')],
  ['close', 'cleaning', 'prep', L('Marinierstation reinigen', 'Clean the marinating station', 'نظّف محطة التتبيل', 'Marine istasyonunu temizle'),
    L('Reste weg, reinigen, desinfizieren laut Plan. Foto.', 'Remove leftovers, clean, disinfect as per plan. Photo.', 'أزل البقايا، نظّف، عقّم حسب الخطة. صورة.', 'Artıkları at, temizle, plana göre dezenfekte et. Fotoğraf.'), { photo: 1, sop: 'SOP-SURFACES' }],
  ['close', 'cleaning', 'prep', L('Messer und Schneidebretter reinigen', 'Clean knives and cutting boards', 'نظّف السكاكين وألواح التقطيع', 'Bıçak ve kesme tahtalarını temizle'),
    L('Spülen, desinfizieren, trocken lagern.', 'Wash, disinfect, store dry.', 'اغسل، عقّم، خزّن جافًا.', 'Yıka, dezenfekte et, kuru sakla.'), { sop: 'SOP-SURFACES' }],
  ['close', 'cleaning', 'fryer', L('Fritteusen außen reinigen', 'Clean fryers outside', 'نظّف القلايات من الخارج', 'Fritözleri dıştan temizle'),
    L('Nur außen, Gerät kalt bzw. laut Herstelleranleitung.', 'Outside only, device cold or as per manufacturer.', 'من الخارج فقط، الجهاز بارد أو حسب الشركة المصنّعة.', 'Sadece dış, cihaz soğuk veya üreticiye göre.')],
  ['close', 'cleaning', 'snow', L('Wärmevitrine reinigen', 'Clean the warming cabinet', 'نظّف خزانة التسخين', 'Isıtma vitrinini temizle'),
    L('Nach Herstelleranleitung. Foto.', 'As per manufacturer manual. Photo.', 'حسب دليل الشركة المصنّعة. صورة.', 'Üretici kılavuzuna göre. Fotoğraf.'), { photo: 1 }],
  ['close', 'cleaning', 'box', L('Burger- und Verpackungsstation reinigen', 'Clean burger and packing station', 'نظّف محطة البرغر والتغليف', 'Burger ve paket istasyonunu temizle'),
    L('Flächen, Behälter, Spender.', 'Surfaces, containers, dispensers.', 'الأسطح والأوعية والموزعات.', 'Yüzeyler, kaplar, dispenserler.'), { station: 'burger' }],
  ['close', 'cleaning', 'run', L('Spülbecken reinigen', 'Clean the sinks', 'نظّف أحواض الغسيل', 'Lavaboları temizle'),
    L('Becken, Armatur, Abfluss.', 'Basin, tap, drain.', 'الحوض والصنبور والمصرف.', 'Lavabo, musluk, gider.')],
  ['close', 'cleaning', 'clean', L('Boden reinigen', 'Clean the floor', 'نظّف الأرضية', 'Zemini temizle'),
    L('Küche, Lager, Gastraum. Warnschild aufstellen.', 'Kitchen, storage, dining room. Put up warning sign.', 'المطبخ والمخزن والصالة. ضع لافتة تحذير.', 'Mutfak, depo, salon. Uyarı levhası koy.'), { photo: 1 }],
  ['close', 'cleaning', 'store', L('Verkaufstheke reinigen', 'Clean the sales counter', 'نظّف كاونتر البيع', 'Satış tezgâhını temizle'),
    L('Theke, Bildschirme, Ablagen.', 'Counter, screens, shelves.', 'الكاونتر والشاشات والرفوف.', 'Tezgâh, ekranlar, raflar.'), { station: 'theke' }],
  ['close', 'cleaning', 'warn', L('Abzugshaube und Fettfilter reinigen (wöchentlich)', 'Clean extractor hood and grease filters (weekly)', 'نظّف شفاط المطبخ وفلاتر الدهون (أسبوعيًا)', 'Davlumbaz ve yağ filtrelerini temizle (haftalık)'),
    L('Nach freigegebenem Reinigungsplan, bei Bedarf häufiger. Foto.', 'As per approved cleaning plan, more often if needed. Photo.', 'حسب خطة التنظيف المعتمدة، أكثر عند الحاجة. صورة.', 'Onaylı temizlik planına göre, gerekirse daha sık. Fotoğraf.'), { photo: 1, freq: 'weekly', weekdays: '2', role: 'shift_lead', carry: 1 }],
  ['close', 'cleaning', 'clean', L('Wände und Fliesen reinigen (wöchentlich)', 'Clean walls and tiles (weekly)', 'نظّف الجدران والبلاط (أسبوعيًا)', 'Duvar ve fayansları temizle (haftalık)'),
    L('Spritzbereiche zuerst. Foto.', 'Splash areas first. Photo.', 'مناطق الرذاذ أولًا. صورة.', 'Önce sıçrama alanları. Fotoğraf.'), { photo: 1, freq: 'weekly', weekdays: '4', carry: 1 }],
  ['close', 'cleaning', 'eye', L('Unter und hinter Geräten reinigen (wöchentlich)', 'Clean under and behind equipment (weekly)', 'نظّف تحت وخلف الأجهزة (أسبوعيًا)', 'Cihazların altını ve arkasını temizle (haftalık)'),
    L('Nur wenn sicher möglich. Kabel nicht beschädigen. Foto.', 'Only if safe. Do not damage cables. Photo.', 'فقط إذا كان آمنًا. لا تتلف الأسلاك. صورة.', 'Sadece güvenliyse. Kablolara zarar verme. Fotoğraf.'), { photo: 1, freq: 'weekly', weekdays: '5', carry: 1 }],
  ['close', 'cleaning', 'box', L('Regale und Lager reinigen (wöchentlich)', 'Clean shelves and storage (weekly)', 'نظّف الرفوف والمخزن (أسبوعيًا)', 'Rafları ve depoyu temizle (haftalık)'),
    L('Ware sicher umlagern, Kühlware kühl halten.', 'Move goods safely, keep chilled goods cold.', 'انقل البضاعة بأمان وأبقِ المبرد باردًا.', 'Malları güvenle taşı, soğuk malı soğuk tut.'), { photo: 1, freq: 'weekly', weekdays: '6', carry: 1 }],
  ['close', 'cleaning', 'fryer', L('Fritteusen-Grundreinigung (wöchentlich)', 'Fryer deep clean (weekly)', 'تنظيف عميق للقلايات (أسبوعيًا)', 'Fritöz derin temizlik (haftalık)'),
    L('Nur nach freigegebener Herstelleranleitung und mit Freigabe.', 'Only as per approved manufacturer manual and with sign-off.', 'فقط حسب دليل الشركة المعتمد ومع الإذن.', 'Sadece onaylı üretici kılavuzuna göre ve onayla.'), { freq: 'weekly', weekdays: '7', course: 'C-FRYER-GGM', sop: 'SOP-FRYER-GGM', carry: 1 }],
];

const SOPS = [
  ['SOP-HANDS', 'hygiene', 'hands', 'not_required', L(
    { title: 'Hände waschen', steps: [
      { icon: 'hands', text: 'Schmuck ablegen. Hände nass machen.' },
      { icon: 'spray', text: 'Seife nehmen. Hände überall einreiben, auch zwischen den Fingern.' },
      { icon: 'run', text: 'Mit Wasser abspülen.' },
      { icon: 'check', text: 'Mit Einmalhandtuch abtrocknen. Wasserhahn mit dem Tuch schließen.' }] },
    { title: 'Washing hands', steps: [
      { icon: 'hands', text: 'Take off jewellery. Wet your hands.' },
      { icon: 'spray', text: 'Take soap. Rub everywhere, also between the fingers.' },
      { icon: 'run', text: 'Rinse with water.' },
      { icon: 'check', text: 'Dry with a paper towel. Close the tap with the towel.' }] },
    { title: 'غسل اليدين', steps: [
      { icon: 'hands', text: 'اخلع المجوهرات. بلّل يديك.' },
      { icon: 'spray', text: 'خذ الصابون. افرك كل مكان، وبين الأصابع أيضًا.' },
      { icon: 'run', text: 'اشطف بالماء.' },
      { icon: 'check', text: 'جفّف بمنشفة ورقية. أغلق الصنبور بالمنشفة.' }] },
    { title: 'El yıkama', steps: [
      { icon: 'hands', text: 'Takıları çıkar. Ellerini ıslat.' },
      { icon: 'spray', text: 'Sabun al. Her yere, parmak aralarına da sür.' },
      { icon: 'run', text: 'Suyla durula.' },
      { icon: 'check', text: 'Kâğıt havluyla kurula. Musluğu havluyla kapat.' }] })],
  ['SOP-SURFACES', 'cleaning', 'spray', 'pending', L(
    { title: 'Flächen reinigen und desinfizieren', steps: [
      { icon: 'clean', text: 'Grobe Reste entfernen.' },
      { icon: 'spray', text: 'Reinigungsmittel genau nach Etikett und Sicherheitsdatenblatt benutzen. Dosierung und Einwirkzeit stehen dort.' },
      { icon: 'shield', text: 'Handschuhe tragen, wenn das Etikett es verlangt.' },
      { icon: 'check', text: 'Wenn nötig mit klarem Wasser nachwischen. Trocknen lassen.' }] },
    { title: 'Cleaning and disinfecting surfaces', steps: [
      { icon: 'clean', text: 'Remove food residue.' },
      { icon: 'spray', text: 'Use the product exactly as on the label and safety data sheet. Dose and contact time are written there.' },
      { icon: 'shield', text: 'Wear gloves if the label says so.' },
      { icon: 'check', text: 'Rinse with clean water if needed. Let it dry.' }] },
    { title: 'تنظيف الأسطح وتعقيمها', steps: [
      { icon: 'clean', text: 'أزل بقايا الطعام.' },
      { icon: 'spray', text: 'استخدم المنتج كما في الملصق وورقة بيانات السلامة تمامًا. الجرعة ومدة التأثير مكتوبة هناك.' },
      { icon: 'shield', text: 'ارتدِ القفازات إذا طلب الملصق ذلك.' },
      { icon: 'check', text: 'اشطف بالماء النظيف عند الحاجة. اتركه يجف.' }] },
    { title: 'Yüzey temizliği ve dezenfeksiyon', steps: [
      { icon: 'clean', text: 'Yemek artıklarını temizle.' },
      { icon: 'spray', text: 'Ürünü etikette ve güvenlik bilgi formunda yazdığı gibi kullan. Doz ve bekleme süresi orada yazar.' },
      { icon: 'shield', text: 'Etiket istiyorsa eldiven giy.' },
      { icon: 'check', text: 'Gerekirse temiz suyla durula. Kurumaya bırak.' }] })],
  ['SOP-SHUTDOWN', 'equipment', 'power', 'pending', L(
    { title: 'Geräte am Abend abschalten', steps: [
      { icon: 'snow', text: 'Kühlschränke und Tiefkühler NIEMALS ausschalten.' },
      { icon: 'shield', text: 'Brandschutz, Lüftung und Notbeleuchtung nicht ausschalten, außer der Manager sagt es.' },
      { icon: 'power', text: 'Andere Geräte nur nach ihrer freigegebenen Anleitung abschalten.' },
      { icon: 'warn', text: 'Unsicher? Nicht abschalten. Problem melden.' }] },
    { title: 'Switching off equipment at night', steps: [
      { icon: 'snow', text: 'NEVER switch off fridges and freezers.' },
      { icon: 'shield', text: 'Do not switch off fire protection, ventilation or emergency lights unless the manager says so.' },
      { icon: 'power', text: 'Switch off other equipment only as in its approved instructions.' },
      { icon: 'warn', text: 'Not sure? Do not switch off. Report a problem.' }] },
    { title: 'إطفاء الأجهزة مساءً', steps: [
      { icon: 'snow', text: 'لا تطفئ الثلاجات والمجمّدات أبدًا.' },
      { icon: 'shield', text: 'لا تطفئ الحماية من الحريق والتهوية وإضاءة الطوارئ إلا إذا قال المدير ذلك.' },
      { icon: 'power', text: 'أطفئ الأجهزة الأخرى فقط حسب تعليماتها المعتمدة.' },
      { icon: 'warn', text: 'غير متأكد؟ لا تطفئ. أبلغ عن مشكلة.' }] },
    { title: 'Akşam cihazları kapatma', steps: [
      { icon: 'snow', text: 'Buzdolaplarını ve dondurucuları ASLA kapatma.' },
      { icon: 'shield', text: 'Yangın koruma, havalandırma ve acil ışıkları müdür söylemedikçe kapatma.' },
      { icon: 'power', text: 'Diğer cihazları sadece onaylı talimatlarına göre kapat.' },
      { icon: 'warn', text: 'Emin değil misin? Kapatma. Sorun bildir.' }] })],
  ['SOP-FRYER-GGM', 'equipment', 'fryer', 'pending', L(
    { title: 'GGM Hochdruckfritteuse – Bedienung', steps: [
      { icon: 'lock', text: 'Nur Mitarbeiter mit praktischer Freigabe dürfen das Gerät bedienen.' },
      { icon: 'book', text: 'Genaues Modell und Originalanleitung des Herstellers prüfen. Diese Anleitung ist noch nicht freigegeben.' },
      { icon: 'warn', text: 'Deckel nur so öffnen, wie es die Herstelleranleitung erlaubt. Sicherheitsfunktionen nie umgehen.' },
      { icon: 'warn', text: 'Bei Störung: Gerät nicht weiter benutzen, Manager informieren, Problem melden.' }] },
    { title: 'GGM pressure fryer – operation', steps: [
      { icon: 'lock', text: 'Only staff with a practical sign-off may operate the device.' },
      { icon: 'book', text: 'Check the exact model and the original manufacturer manual. These instructions are not approved yet.' },
      { icon: 'warn', text: 'Open the lid only as the manufacturer manual allows. Never bypass safety features.' },
      { icon: 'warn', text: 'If there is a fault: stop using it, tell the manager, report a problem.' }] },
    { title: 'قلاية الضغط GGM – التشغيل', steps: [
      { icon: 'lock', text: 'فقط الموظفون الحاصلون على إذن عملي يمكنهم تشغيل الجهاز.' },
      { icon: 'book', text: 'تحقّق من الطراز الدقيق ودليل الشركة المصنّعة الأصلي. هذه التعليمات غير معتمدة بعد.' },
      { icon: 'warn', text: 'افتح الغطاء فقط كما يسمح دليل الشركة المصنّعة. لا تتجاوز وسائل الأمان أبدًا.' },
      { icon: 'warn', text: 'عند حدوث عطل: توقّف عن الاستخدام، أخبر المدير، أبلغ عن مشكلة.' }] },
    { title: 'GGM basınçlı fritöz – kullanım', steps: [
      { icon: 'lock', text: 'Cihazı sadece pratik onayı olan personel kullanabilir.' },
      { icon: 'book', text: 'Tam modeli ve üreticinin orijinal kılavuzunu kontrol et. Bu talimat henüz onaylı değil.' },
      { icon: 'warn', text: 'Kapağı sadece üretici kılavuzunun izin verdiği şekilde aç. Güvenlik özelliklerini asla devre dışı bırakma.' },
      { icon: 'warn', text: 'Arıza olursa: kullanmayı bırak, müdüre söyle, sorun bildir.' }] })],
];

const COURSES = [
  ['C-HYGIENE', 'hands', 0, 100, L(
    { title: 'Händehygiene', intro: 'Saubere Hände schützen Gäste und Kollegen.',
      steps: [
        { icon: 'hands', text: 'Hände waschen: vor der Arbeit, nach rohem Fleisch, nach Müll, nach der Toilette, nach der Pause.' },
        { icon: 'spray', text: 'Mit Seife waschen, überall einreiben, abspülen, mit Einmalhandtuch abtrocknen.' },
        { icon: 'warn', text: 'Krank (z. B. Durchfall, Erbrechen, Fieber)? Nicht arbeiten, sofort Manager anrufen.' }],
      questions: [
        { q: 'Wann musst du Hände waschen?', options: ['Nur am Morgen', 'Nach rohem Fleisch und nach Müll', 'Nur wenn sie schmutzig aussehen'], correct: 1 },
        { q: 'Was zeigt das Bild?', image: 'hands', options: ['Hände waschen', 'Licht ausschalten', 'Müll rausbringen'], correct: 0 },
        { q: 'Du hast Durchfall. Was tust du?', options: ['Trotzdem arbeiten', 'Handschuhe anziehen', 'Nicht arbeiten und Manager anrufen'], correct: 2 }] },
    { title: 'Hand hygiene', intro: 'Clean hands protect guests and colleagues.',
      steps: [
        { icon: 'hands', text: 'Wash hands: before work, after raw meat, after rubbish, after the toilet, after breaks.' },
        { icon: 'spray', text: 'Wash with soap, rub everywhere, rinse, dry with a paper towel.' },
        { icon: 'warn', text: 'Ill (e.g. diarrhoea, vomiting, fever)? Do not work, call the manager at once.' }],
      questions: [
        { q: 'When must you wash your hands?', options: ['Only in the morning', 'After raw meat and after rubbish', 'Only when they look dirty'], correct: 1 },
        { q: 'What does the picture show?', image: 'hands', options: ['Washing hands', 'Switching off lights', 'Taking out rubbish'], correct: 0 },
        { q: 'You have diarrhoea. What do you do?', options: ['Work anyway', 'Put on gloves', 'Do not work and call the manager'], correct: 2 }] },
    { title: 'نظافة اليدين', intro: 'اليدان النظيفتان تحميان الزبائن والزملاء.',
      steps: [
        { icon: 'hands', text: 'اغسل يديك: قبل العمل، بعد اللحم النيء، بعد القمامة، بعد المرحاض، بعد الاستراحة.' },
        { icon: 'spray', text: 'اغسل بالصابون، افرك كل مكان، اشطف، جفّف بمنشفة ورقية.' },
        { icon: 'warn', text: 'مريض (مثل إسهال، تقيؤ، حمى)؟ لا تعمل واتصل بالمدير فورًا.' }],
      questions: [
        { q: 'متى يجب أن تغسل يديك؟', options: ['في الصباح فقط', 'بعد اللحم النيء وبعد القمامة', 'فقط عندما تبدو متسخة'], correct: 1 },
        { q: 'ماذا تُظهر الصورة؟', image: 'hands', options: ['غسل اليدين', 'إطفاء الإضاءة', 'إخراج القمامة'], correct: 0 },
        { q: 'لديك إسهال. ماذا تفعل؟', options: ['أعمل رغم ذلك', 'أرتدي القفازات', 'لا أعمل وأتصل بالمدير'], correct: 2 }] },
    { title: 'El hijyeni', intro: 'Temiz eller misafirleri ve iş arkadaşlarını korur.',
      steps: [
        { icon: 'hands', text: 'Ellerini yıka: işten önce, çiğ etten sonra, çöpten sonra, tuvaletten sonra, moladan sonra.' },
        { icon: 'spray', text: 'Sabunla yıka, her yere sür, durula, kâğıt havluyla kurula.' },
        { icon: 'warn', text: 'Hasta mısın (ishal, kusma, ateş)? Çalışma, hemen müdürü ara.' }],
      questions: [
        { q: 'Ellerini ne zaman yıkamalısın?', options: ['Sadece sabah', 'Çiğ etten ve çöpten sonra', 'Sadece kirli görünürse'], correct: 1 },
        { q: 'Resimde ne var?', image: 'hands', options: ['El yıkama', 'Işıkları kapatma', 'Çöpü çıkarma'], correct: 0 },
        { q: 'İshalin var. Ne yaparsın?', options: ['Yine de çalışırım', 'Eldiven giyerim', 'Çalışmam ve müdürü ararım'], correct: 2 }] })],
  ['C-FRYER-GGM', 'fryer', 1, 100, L(
    { title: 'Hochdruckfritteuse: Sicherheit', intro: 'ENTWURF: Grundregeln. Die modellspezifische Herstelleranleitung fehlt noch.',
      steps: [
        { icon: 'lock', text: 'Nur mit praktischer Freigabe durch einen Trainer darfst du die Fritteuse bedienen.' },
        { icon: 'book', text: 'Es gilt immer die Originalanleitung des Herstellers für genau dieses Modell.' },
        { icon: 'warn', text: 'Sicherheitsfunktionen und Verriegelungen nie umgehen.' },
        { icon: 'warn', text: 'Bei Störung: Gerät nicht weiter benutzen, Manager informieren.' }],
      questions: [
        { q: 'Wer darf die Hochdruckfritteuse bedienen?', options: ['Jeder Mitarbeiter', 'Nur Mitarbeiter mit praktischer Freigabe', 'Jeder nach diesem Test'], correct: 1 },
        { q: 'Was ist bei einer Störung richtig?', options: ['Weiterarbeiten', 'Verriegelung umgehen', 'Nicht weiter benutzen und Manager informieren'], correct: 2 },
        { q: 'Welche Anleitung gilt?', image: 'book', options: ['Die Originalanleitung des Herstellers', 'Ein Video aus dem Internet', 'Was ein Kollege sagt'], correct: 0 }] },
    { title: 'Pressure fryer: safety', intro: 'DRAFT: basic rules. The model-specific manufacturer manual is still missing.',
      steps: [
        { icon: 'lock', text: 'You may only operate the fryer with a practical sign-off from a trainer.' },
        { icon: 'book', text: 'The original manufacturer manual for exactly this model always applies.' },
        { icon: 'warn', text: 'Never bypass safety features or interlocks.' },
        { icon: 'warn', text: 'If there is a fault: stop using it, tell the manager.' }],
      questions: [
        { q: 'Who may operate the pressure fryer?', options: ['Any employee', 'Only staff with a practical sign-off', 'Anyone after this test'], correct: 1 },
        { q: 'What is right if there is a fault?', options: ['Keep working', 'Bypass the interlock', 'Stop using it and tell the manager'], correct: 2 },
        { q: 'Which instructions apply?', image: 'book', options: ['The original manufacturer manual', 'A video from the internet', 'What a colleague says'], correct: 0 }] },
    { title: 'قلاية الضغط: السلامة', intro: 'مسودة: قواعد أساسية. دليل الشركة المصنّعة الخاص بالطراز غير متوفر بعد.',
      steps: [
        { icon: 'lock', text: 'يمكنك تشغيل القلاية فقط بعد إذن عملي من المدرّب.' },
        { icon: 'book', text: 'يسري دائمًا دليل الشركة المصنّعة الأصلي لهذا الطراز بالذات.' },
        { icon: 'warn', text: 'لا تتجاوز وسائل الأمان والأقفال أبدًا.' },
        { icon: 'warn', text: 'عند حدوث عطل: توقّف عن الاستخدام وأخبر المدير.' }],
      questions: [
        { q: 'من يمكنه تشغيل قلاية الضغط؟', options: ['أي موظف', 'فقط الحاصلون على إذن عملي', 'أي شخص بعد هذا الاختبار'], correct: 1 },
        { q: 'ما الصحيح عند حدوث عطل؟', options: ['أواصل العمل', 'أتجاوز القفل', 'أتوقف عن الاستخدام وأخبر المدير'], correct: 2 },
        { q: 'أي تعليمات تسري؟', image: 'book', options: ['دليل الشركة المصنّعة الأصلي', 'فيديو من الإنترنت', 'ما يقوله زميل'], correct: 0 }] },
    { title: 'Basınçlı fritöz: güvenlik', intro: 'TASLAK: temel kurallar. Modele özel üretici kılavuzu henüz yok.',
      steps: [
        { icon: 'lock', text: 'Fritözü sadece eğitmenden pratik onay aldıktan sonra kullanabilirsin.' },
        { icon: 'book', text: 'Her zaman tam bu modelin orijinal üretici kılavuzu geçerlidir.' },
        { icon: 'warn', text: 'Güvenlik özelliklerini ve kilitleri asla devre dışı bırakma.' },
        { icon: 'warn', text: 'Arıza olursa: kullanmayı bırak, müdüre söyle.' }],
      questions: [
        { q: 'Basınçlı fritözü kim kullanabilir?', options: ['Her çalışan', 'Sadece pratik onayı olanlar', 'Bu testten sonra herkes'], correct: 1 },
        { q: 'Arıza olunca doğru olan ne?', options: ['Çalışmaya devam', 'Kilidi devre dışı bırak', 'Kullanmayı bırak ve müdüre söyle'], correct: 2 },
        { q: 'Hangi talimat geçerli?', image: 'book', options: ['Orijinal üretici kılavuzu', 'İnternetten bir video', 'Bir arkadaşın söyledikleri'], correct: 0 }] })],
];


// Stationen mit eigener Stationscheck-Liste (eigene ForHuman-Inhalte). Kritische Punkte müssen immer erfüllt sein.
// [code, icon, name(L), sop, course, items: [text, critical]]
const STATIONS = [
  ['panieren', 'prep', L('Panierstation', 'Breading station', 'محطة التغليف بالبقسماط', 'Pane istasyonu'), null, 'C-HYGIENE', [
    ['Hände gewaschen, Handschuhe nach Vorgabe gewechselt', 1],
    ['Rohes Hähnchen strikt getrennt von fertiger Ware und Verpackung', 1],
    ['Kühlkette eingehalten: Rohware nur kurz ungekühlt, Rest sofort zurück in die Kühlung', 1],
    ['Panieren genau nach freigegebener Anleitung (Reihenfolge, Menge)', 0],
    ['Arbeitsplatz vorher vorbereitet und zwischendurch sauber gehalten', 0],
    ['Utensilien und Behälter nach Vorgabe getauscht und gereinigt', 0],
    ['Abfall und Verpackung richtig entsorgt', 0]]],
  ['druckfritteuse', 'fryer', L('Hochdruckfritteuse', 'Pressure fryer', 'قلاية الضغط', 'Basınçlı fritöz'), 'SOP-FRYER-GGM', 'C-FRYER-GGM', [
    ['Schutzkleidung nach Vorgabe getragen', 1],
    ['Gerät nur nach freigegebener Herstelleranleitung bedient', 1],
    ['Sicherheitsfunktionen und Verriegelungen nie umgangen', 1],
    ['Programm und Timer für das Produkt benutzt', 0],
    ['Produkt nach Vorgabe geprüft, bevor es in die Warmhaltung geht', 1],
    ['Ölmessung im Ölmanager dokumentiert', 0],
    ['Bei Störung sofort gestoppt und Leitung informiert (Frage/Simulation)', 1]]],
  ['pommes', 'fryer', L('Pommes-Fritteuse', 'Fries fryer', 'قلاية البطاطا', 'Patates fritözü'), null, 'C-HYGIENE', [
    ['Körbe nicht überfüllt, Öl nicht verspritzt', 1],
    ['Programm/Timer benutzt', 0],
    ['Abtropfen lassen, Salz nach Vorgabe', 0],
    ['Haltezeit-Timer gestartet', 1],
    ['Arbeitsplatz sauber und trocken (Rutschgefahr)', 1]]],
  ['burger', 'prep', L('Burger & Wraps', 'Burgers & wraps', 'البرغر واللفائف', 'Burger ve dürüm'), null, 'C-HYGIENE', [
    ['Hände/Handschuhe nach Vorgabe', 1],
    ['Aufbau genau nach Bild-Bauplan', 0],
    ['Nur Ware innerhalb der Haltezeit verwendet', 1],
    ['Sonderwünsche und Allergene der Bestellung beachtet', 1],
    ['Fläche zwischendurch gereinigt', 0]]],
  ['theke', 'store', L('Kasse & Theke', 'Counter', 'الكاشير والكاونتر', 'Kasa ve tezgâh'), null, 'C-ALLERGENS', [
    ['Gast freundlich begrüßt und angesehen', 0],
    ['Bestellung wiederholt und geprüft', 0],
    ['Fragen zu Allergenen: richtige Information geholt, nicht geraten', 1],
    ['Theke und Bildschirme sauber', 0],
    ['Bon/Rückgeld korrekt', 0]]],
  ['ausgabe', 'box', L('Packen & Ausgabe', 'Packing & handover', 'التغليف والتسليم', 'Paketleme ve teslim'), null, 'C-HYGIENE', [
    ['Bestellung vollständig mit Bon abgeglichen', 0],
    ['Heiß und kalt getrennt verpackt', 0],
    ['Sonderwünsche/Allergene noch einmal geprüft', 1],
    ['Nur Ware innerhalb der Haltezeit ausgegeben', 1],
    ['Tüte/Box sauber verschlossen, Gast/Fahrer freundlich übergeben', 0]]],
];

// Produkte für Haltezeit-Timer. Zeiten sind leer – nur die Leitung trägt sie mit Quelle ein.
const PRODUCTS = [
  [L('Hähnchenteile', 'Chicken pieces', 'قطع الدجاج', 'Tavuk parçaları'), 'fryer', 'druckfritteuse'],
  [L('Hähnchenfilet / Strips', 'Chicken strips', 'شرائح الدجاج', 'Tavuk şeritleri'), 'fryer', 'druckfritteuse'],
  [L('Wings', 'Wings', 'أجنحة', 'Kanat'), 'fryer', 'druckfritteuse'],
  [L('Pommes', 'Fries', 'بطاطا مقلية', 'Patates kızartması'), 'fryer', 'pommes'],
  [L('Burger-Filet', 'Burger fillet', 'فيليه البرغر', 'Burger fileto'), 'prep', 'burger'],
];

export function seedStations(db, branchId) {
  if (db.prepare('SELECT COUNT(*) n FROM stations WHERE branch_id = ?').get(branchId).n) return;
  tx(db, () => {
    const insS = db.prepare('INSERT INTO stations (branch_id, code, name, icon, position, sop_id, course_id) VALUES (?,?,?,?,?,?,?)');
    const insI = db.prepare('INSERT INTO observation_items (station_id, position, text, critical) VALUES (?,?,?,?)');
    STATIONS.forEach(([code, icon, name, sop, course, items], k) => {
      const sid = insS.run(branchId, code, JSON.stringify(name), icon, (k + 1) * 10, sop ? idBy(db, 'sops', sop) : null, course ? idBy(db, 'courses', course) : null).lastInsertRowid;
      items.forEach(([text, crit], i) => insI.run(sid, (i + 1) * 10, JSON.stringify({ de: text }), crit));
    });
    const insP = db.prepare('INSERT INTO products (branch_id, name, icon, station_id) VALUES (?,?,?,?)');
    for (const [name, icon, st] of PRODUCTS) {
      const sid = db.prepare('SELECT id FROM stations WHERE branch_id = ? AND code = ?').get(branchId, st)?.id ?? null;
      insP.run(branchId, JSON.stringify(name), icon, sid);
    }
  });
}

export function seedDailyItems(db) {
  // Artikel der täglichen Inventurliste (Vorlage des Betreibers)
  // Täglich gezählt: Fleisch, Pommes, Öl, Wraps, Burger-Brötchen usw.; Saucen und Marinaden nur wöchentlich (Wocheninventur)
  const insItem = db.prepare('INSERT INTO items (name, unit, category, daily_count, meat) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM items WHERE name = ?)');
  for (const [name, unit, cat, meat] of DAILY_ITEMS) insItem.run(name, unit, cat, ['Sauce', 'Marinade'].includes(cat) ? 0 : 1, meat, name);
}

export function seedBase(db, { dailyItems = true } = {}) {
  tx(db, () => {
    const insBranch = db.prepare('INSERT OR IGNORE INTO branches (code, name) VALUES (?, ?)');
    insBranch.run('halle', 'Halle');
    insBranch.run('leuna', 'Leuna');
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('photo_retention_days', '365')").run();
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('notification_channels', '[]')").run();

    const insSop = db.prepare('INSERT OR IGNORE INTO sops (code, category, icon, safety_review) VALUES (?,?,?,?)');
    for (const [code, cat, icon, review, content] of SOPS) {
      const r = insSop.run(code, cat, icon, review);
      if (r.changes) {
        // Erstversion als Entwurf. Erst ein Admin gibt sie frei; Sicherheitsprüfung separat (safety_review).
        db.prepare("INSERT INTO sop_versions (sop_id, version_no, status, content, reviewed_langs, approved_by, approved_at) VALUES (?, 1, 'draft', ?, 'de', NULL, NULL)")
          .run(r.lastInsertRowid, JSON.stringify(content));
      }
    }

    const insCourse = db.prepare('INSERT OR IGNORE INTO courses (code, icon, safety_critical, pass_percent, content) VALUES (?,?,?,?,?)');
    for (const [code, icon, crit, pass, content] of [...COURSES, ...EXTRA_COURSES]) insCourse.run(code, icon, crit, pass, JSON.stringify(content));
  });
  if (dailyItems) seedDailyItems(db);
  seedTraining(db);
  // Startvorlagen je Filiale (Manager kann sie danach ändern, sortieren, abschalten)
  for (const b of db.prepare('SELECT id FROM branches').all()) { seedStations(db, b.id); seedTemplates(db, b.id); seedControls(db, b.id); }
}

function idBy(db, table, code) {
  return db.prepare(`SELECT id FROM ${table} WHERE code = ?`).get(code)?.id ?? null;
}

export function seedTemplates(db, branchId) {
  const has = db.prepare('SELECT COUNT(*) AS n FROM task_templates WHERE branch_id = ?').get(branchId).n;
  if (has) return;
  const ins = db.prepare(`INSERT INTO task_templates (branch_id, shift, position, category, frequency, weekdays, month_day, icon, title, hint,
    requires_photo, measure_unit, sop_id, required_course_id, station_id, role, link, action, carry_over) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const pos = { open: 0, run: 0, close: 0 };
  tx(db, () => {
    for (const [shift, cat, icon, title, hint, o = {}] of TEMPLATES) {
      pos[shift] += 10;
      ins.run(branchId, shift, pos[shift], cat, o.freq || 'daily', o.weekdays || '1234567', o.monthDay ?? null, icon,
        JSON.stringify(title), JSON.stringify(hint), o.photo ? 1 : 0, o.unit ?? null,
        o.sop ? idBy(db, 'sops', o.sop) : null, o.course ? idBy(db, 'courses', o.course) : null,
        o.station ? db.prepare('SELECT id FROM stations WHERE branch_id = ? AND code = ?').get(branchId, o.station)?.id ?? null : null,
        o.role || 'all', o.link || null, o.link || o.action || null, o.carry ? 1 : 0);
    }
  });
}

/** Fiktive Demo-Daten. Nur für DEMO_MODE (In-Memory-Datenbank). */
export function seedDemo(db) {
  seedBase(db, { dailyItems: false });
  // In der Demo gelten die Erstversionen als freigegeben (durch Demo-Admin), damit der Ablauf sichtbar ist.
  const hash = hashPassword('demo-nur-lokal-' + Math.random());
  tx(db, () => {
    const insUser = db.prepare('INSERT INTO users (username, display_name, password_hash, is_admin) VALUES (?,?,?,?)');
    const users = {
      admin: insUser.run('demo.admin', 'Demo Betreiber (fiktiv)', hash, 1).lastInsertRowid,
      mgrHalle: insUser.run('demo.leitung.halle', 'Demo Filialleitung Halle (fiktiv)', hash, 0).lastInsertRowid,
      mgrLeuna: insUser.run('demo.leitung.leuna', 'Demo Filialleitung Leuna (fiktiv)', hash, 0).lastInsertRowid,
      trainer: insUser.run('demo.trainer', 'Demo Trainer (fiktiv)', hash, 0).lastInsertRowid,
      empHalle: insUser.run('demo.mitarbeiter.halle', 'Demo Mitarbeiter A (fiktiv)', hash, 0).lastInsertRowid,
      empLeuna: insUser.run('demo.mitarbeiter.leuna', 'Demo Mitarbeiter B (fiktiv)', hash, 0).lastInsertRowid,
      leadHalle: insUser.run('demo.schichtfuehrer.halle', 'Demo Schichtführer Halle (fiktiv)', hash, 0).lastInsertRowid,
      empHalle2: insUser.run('demo.mitarbeiter.halle2', 'Demo Mitarbeiter C (fiktiv)', hash, 0).lastInsertRowid,
    };
    const halle = idBy(db, 'branches', 'halle'), leuna = idBy(db, 'branches', 'leuna');
    const mem = db.prepare('INSERT INTO memberships (user_id, branch_id, role) VALUES (?,?,?)');
    mem.run(users.mgrHalle, halle, 'manager');
    mem.run(users.mgrLeuna, leuna, 'manager');
    mem.run(users.trainer, halle, 'trainer');
    mem.run(users.trainer, leuna, 'trainer');
    mem.run(users.empHalle, halle, 'employee');
    mem.run(users.empLeuna, leuna, 'employee');
    mem.run(users.leadHalle, halle, 'shift_lead');
    mem.run(users.empHalle2, halle, 'employee');
    db.prepare("UPDATE sop_versions SET status = 'approved', approved_by = ?, approved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')").run(users.admin);

    // Fiktiver Artikelstamm. GTINs aus dem GS1-Bereich 20-29 (nur für interne Nutzung, kollidiert nie mit echten Produkten), gültige Prüfziffer.
    const insItem = db.prepare('INSERT INTO items (name, unit, category, metro_article_no, needs_temperature) VALUES (?,?,?,?,?)');
    const insCode = db.prepare('INSERT INTO item_codes (code, item_id, kind) VALUES (?,?,?)');
    const items = [
      ['DEMO Hähnchenschenkel (fiktiv)', 'kg', 'Kühlware', 'DEMO-100001', 1, '02000000000015'],
      ['DEMO Frittieröl (fiktiv)', 'L', 'Trockenware', 'DEMO-100002', 0, '02000000000022'],
      ['DEMO Panade (fiktiv)', 'kg', 'Trockenware', 'DEMO-100003', 0, '02000000000039'],
      ['DEMO Burgerbrötchen (fiktiv)', 'Stück', 'Backware', 'DEMO-100004', 0, '02000000000046'],
      ['DEMO Servietten (fiktiv)', 'Packung', 'Verbrauch', 'DEMO-100005', 0, null],
    ];
    const setMin = db.prepare('INSERT INTO stock_settings (branch_id, item_id, min_qty) VALUES (?,?,?)');
    const mov = db.prepare("INSERT INTO stock_movements (branch_id, item_id, qty_delta, type, note, created_by) VALUES (?,?,?,'count','Demo-Anfangsbestand (fiktiv)',?)");
    for (const [name, unit, cat, metro, temp, gtin] of items) {
      const id = insItem.run(name, unit, cat, metro, temp).lastInsertRowid;
      insCode.run(metro, id, 'metro_article');
      if (gtin) insCode.run(gtin, id, 'gtin');
      setMin.run(halle, id, 10); setMin.run(leuna, id, 10);
      mov.run(halle, id, unit === 'Packung' ? 4 : 25, users.mgrHalle);
      mov.run(leuna, id, 15, users.mgrLeuna);
    }

    const fryerCourse = idBy(db, 'courses', 'C-FRYER-GGM');
    const insFryer = db.prepare('INSERT INTO fryers (branch_id, name, manufacturer, model, model_verified, oil_product, course_id) VALUES (?,?,?,?,?,?,?)');
    insFryer.run(halle, 'Hähnchen 1', 'GGM Gastro', 'Hochdruckfritteuse (Modell zu prüfen)', 0, 'DEMO Frittieröl (fiktiv)', fryerCourse);
    insFryer.run(halle, 'Pommes 1', 'Frymaster', 'RE122-BLSCS', 0, 'DEMO Frittieröl (fiktiv)', fryerCourse);
    insFryer.run(leuna, 'Hähnchen 1', 'GGM Gastro', 'Hochdruckfritteuse (Modell zu prüfen)', 0, 'DEMO Frittieröl (fiktiv)', fryerCourse);
    db.prepare("UPDATE fryers SET change_interval_days = 7, device_serial = 'DEMO-SN-' || id").run();

    // Demo-Mitarbeiter A hat Hygiene bestanden; Fritteuse noch nicht -> Fritteusen-Aufgaben gesperrt (Qualifikationsprüfung sichtbar).
    const hyg = idBy(db, 'courses', 'C-HYGIENE');
    db.prepare("INSERT INTO exam_attempts (user_id, course_id, course_version, branch_id, lang, score, total, passed, answers) VALUES (?,?,1,?,'de',3,3,1,'[1,0,2]')").run(users.empHalle, hyg, halle);
    db.prepare("INSERT INTO course_progress (user_id, course_id, course_version, lang, steps_done) VALUES (?,?,1,'de',3)").run(users.empHalle, hyg);

    // Stationsfreigaben (fiktiv): Trainer und Schichtführer überall, Mitarbeiter A an Panierstation und Theke.
    const certify = (userId, stationId, observer) => {
      const items = db.prepare('SELECT id, critical FROM observation_items WHERE station_id = ?').all(stationId);
      const oid = db.prepare(`INSERT INTO observations (station_id, branch_id, user_id, observer_id, results, score, total, critical_failed, passed, note)
        SELECT id, branch_id, ?, ?, ?, ?, ?, 0, 1, 'Demo-Freigabe (fiktiv)' FROM stations WHERE id = ?`)
        .run(userId, observer, JSON.stringify(items.map((i) => ({ item_id: i.id, ok: true, critical: !!i.critical }))), items.length, items.length, stationId).lastInsertRowid;
      db.prepare('INSERT INTO station_certifications (user_id, station_id, observation_id, certified_by) VALUES (?,?,?,?)').run(userId, stationId, oid, observer);
    };
    for (const st of db.prepare('SELECT id, branch_id FROM stations').all()) {
      certify(users.trainer, st.id, users.admin);
      if (st.branch_id === halle) certify(users.leadHalle, st.id, users.trainer);
    }
    for (const code of ['panieren', 'theke']) certify(users.empHalle, db.prepare('SELECT id FROM stations WHERE branch_id = ? AND code = ?').get(halle, code).id, users.trainer);
    const pass = (uid, code, branch = halle) => db.prepare("INSERT INTO exam_attempts (user_id, course_id, course_version, branch_id, lang, score, total, passed, answers) VALUES (?,?,1,?,'de',3,3,1,'[]')").run(uid, idBy(db, 'courses', code), branch);
    for (const uid of [users.leadHalle, users.trainer]) for (const c of ['C-HYGIENE', 'C-GOODS', 'C-CLEANING', 'C-ALLERGENS']) pass(uid, c);
    pass(users.empHalle, 'C-GOODS');
    // Demo-Zeiten: ausdrücklich fiktiv. Echte Werte nur aus Herstellerangabe / freigegebener Rezeptur / HACCP-Plan.
    const demoTimes = { 'Hähnchenteile': [20, 900], 'Hähnchenfilet / Strips': [20, 300], 'Wings': [20, 600], 'Pommes': [7, 180], 'Burger-Filet': [15, null] };
    for (const p of db.prepare('SELECT id, name FROM products').all()) {
      const t = demoTimes[JSON.parse(p.name).de];
      if (t) db.prepare("UPDATE products SET hold_minutes = ?, cook_seconds = ?, value_source = 'DEMO-Wert (fiktiv) – nicht für den Betrieb' WHERE id = ?").run(t[0], t[1], p.id);
    }
    for (const b of [halle, leuna]) {
      db.prepare("INSERT INTO products (branch_id, name, icon, hold_minutes, value_source) VALUES (?, ?, 'history', 1, 'DEMO-Test (1 Minute, fiktiv)')")
        .run(b, JSON.stringify({ de: 'DEMO Test-Timer 1 Min', en: 'DEMO test timer 1 min', ar: 'مؤقت تجريبي دقيقة واحدة', tr: 'DEMO test zamanlayıcı 1 dk' }));
    }
  });
  seedDailyItems(db);
  // Fiktive Demo-Rezeptur – keine echte ForHuman-Rezeptur
  const mid = db.prepare("INSERT INTO marinades (name) VALUES ('DEMO Marinade mild (fiktiv)')").run().lastInsertRowid;
  db.prepare(`INSERT INTO marinade_versions (marinade_id, version, ingredients, allergens, tolerance_percent, use_within_hours, use_source, created_by)
    VALUES (?, 1, ?, 'DEMO: Allergene laut Allergenliste der Filiale', 5, 24, 'DEMO-Wert (fiktiv) – nicht für den Betrieb', (SELECT id FROM users WHERE username = 'demo.admin'))`)
    .run(mid, JSON.stringify([{ name: 'DEMO Zutat A', per_kg: 50, unit: 'g' }, { name: 'DEMO Zutat B', per_kg: 20, unit: 'g' }, { name: 'DEMO Flüssigkeit C', per_kg: 100, unit: 'ml' }]));
  // Demo: fiktive Mitarbeiter gelten als eingearbeitet und freigegeben; der tägliche Hygiene-Check ist in der Demo aus
  // (im Echtbetrieb sind beide Sperren standardmäßig an und unter Leitung → Einarbeitung & Hygiene schaltbar).
  const demoAdmin = db.prepare("SELECT id FROM users WHERE username = 'demo.admin'").get().id;
  for (const m of db.prepare("SELECT DISTINCT user_id, branch_id FROM memberships WHERE role IN ('employee','shift_lead')").all())
    db.prepare("INSERT OR IGNORE INTO work_releases (user_id, branch_id, released_by, note) VALUES (?,?,?, 'DEMO')").run(m.user_id, m.branch_id, demoAdmin);
  for (const b of db.prepare('SELECT id FROM branches').all())
    db.prepare("INSERT OR REPLACE INTO branch_settings (branch_id, key, value) VALUES (?, 'gate_hygiene', '0')").run(b.id);
}
