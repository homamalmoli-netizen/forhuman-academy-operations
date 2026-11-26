// Stammdaten (Vorlagen, Kurse, Anleitungen) und eindeutig fiktive Demo-Daten.
// Keine echten Mitarbeiter, keine Rezepturen, keine erfundenen Grenzwerte oder Geräteverfahren.
// Übersetzungen EN/AR/TR sind Entwürfe: reviewed_langs = 'de' -> App zeigt "Übersetzung nicht geprüft".
import { tx } from './db.js';
import { hashPassword } from './auth.js';

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
    L('Nur mit Freigabe. Nach Anleitung des Herstellers.', 'Only if you are approved. Follow the manufacturer manual.', 'فقط بعد الإذن. حسب دليل الشركة المصنّعة.', 'Sadece onaylıysan. Üretici kılavuzuna göre.'), { sop: 'SOP-FRYER-GGM', course: 'C-FRYER-GGM' }],
  ['open', 'goods', 'box', L('Ware prüfen', 'Check stock', 'افحص البضاعة', 'Malları kontrol et'),
    L('Haltbarkeit ansehen. Abgelaufenes melden.', 'Look at best-before dates. Report expired items.', 'انظر إلى تاريخ الصلاحية. أبلغ عن المنتهي.', 'Son kullanma tarihlerine bak. Süresi geçeni bildir.')],
  ['open', 'routine', 'prep', L('Arbeitsplatz vorbereiten', 'Prepare your workstation', 'جهّز مكان العمل', 'Çalışma yerini hazırla'),
    L('Sauber, aufgeräumt, alles griffbereit.', 'Clean, tidy, everything at hand.', 'نظيف ومرتب وكل شيء في متناول اليد.', 'Temiz, düzenli, her şey elinin altında.')],
  // Laufender Betrieb
  ['run', 'hygiene', 'hands', L('Hände waschen', 'Wash your hands', 'اغسل يديك', 'Ellerini yıka'),
    L('Nach rohem Fleisch, Müll und Pause.', 'After raw meat, rubbish and breaks.', 'بعد اللحم النيء والقمامة والاستراحة.', 'Çiğ etten, çöpten ve moladan sonra.'), { sop: 'SOP-HANDS' }],
  ['run', 'hygiene', 'shield', L('Roh und fertig trennen', 'Keep raw and cooked apart', 'افصل النيء عن المطبوخ', 'Çiğ ve pişmişi ayır'),
    L('Eigene Bretter und Zangen benutzen.', 'Use separate boards and tongs.', 'استخدم ألواحًا وملاقط منفصلة.', 'Ayrı tahta ve maşa kullan.')],
  ['run', 'cleaning', 'spray', L('Flächen reinigen', 'Clean surfaces', 'نظّف الأسطح', 'Yüzeyleri temizle'),
    L('Reinigungsmittel laut Etikett benutzen.', 'Use cleaning product as on the label.', 'استخدم المنظّف حسب الملصق.', 'Temizlik ürününü etikete göre kullan.'), { sop: 'SOP-SURFACES' }],
  ['run', 'routine', 'refill', L('Nachfüllen', 'Refill', 'أعد التعبئة', 'Doldur'),
    L('Verpackung, Saucen, Servietten.', 'Packaging, sauces, napkins.', 'العبوات والصلصات والمناديل.', 'Ambalaj, soslar, peçeteler.')],
  ['run', 'equipment', 'oil', L('Öl messen (TPM)', 'Measure oil (TPM)', 'قِس الزيت (TPM)', 'Yağı ölç (TPM)'),
    L('Im Ölmanager eintragen. Foto vom Messgerät.', 'Enter in Oil manager. Photo of the meter.', 'سجّل في إدارة الزيت. صوّر جهاز القياس.', 'Yağ yöneticisine gir. Ölçerin fotoğrafı.'), { course: 'C-FRYER-GGM' }],
  // Schließung / Spätschicht
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
    L('Alle Türen und Fenster prüfen.', 'Check all doors and windows.', 'تحقّق من كل الأبواب والنوافذ.', 'Tüm kapı ve pencereleri kontrol et.'), { photo: 1 }],
  // Wöchentlich / monatlich
  ['close', 'cleaning', 'snow', L('Kühlschrank innen reinigen (wöchentlich)', 'Clean fridge inside (weekly)', 'نظّف الثلاجة من الداخل (أسبوعيًا)', 'Buzdolabı içini temizle (haftalık)'),
    L('Ware umlagern, kühl halten.', 'Move stock, keep it cold.', 'انقل البضاعة وأبقها باردة.', 'Malları taşı, soğuk tut.'), { photo: 1, freq: 'weekly', weekdays: '1' }],
  ['open', 'pest', 'bug', L('Schädlingskontrolle (wöchentlich)', 'Pest check (weekly)', 'فحص الحشرات (أسبوعيًا)', 'Haşere kontrolü (haftalık)'),
    L('Kontrollpunkte ansehen. Nichts selbst sprühen.', 'Look at check points. Do not spray yourself.', 'افحص نقاط المراقبة. لا ترشّ بنفسك.', 'Kontrol noktalarına bak. Kendin ilaçlama.'), { photo: 1, freq: 'weekly', weekdays: '3' }],
  ['open', 'maintenance', 'build', L('Geräte-Sichtprüfung (monatlich)', 'Equipment visual check (monthly)', 'فحص بصري للأجهزة (شهريًا)', 'Cihaz gözle kontrol (aylık)'),
    L('Kabel, Dichtungen, Typenschild. Schäden melden.', 'Cables, seals, rating plate. Report damage.', 'الأسلاك والحشوات ولوحة البيانات. أبلغ عن الأضرار.', 'Kablolar, contalar, etiket. Hasarı bildir.'), { photo: 1, freq: 'monthly', monthDay: 1 }],
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

export function seedBase(db) {
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
    for (const [code, icon, crit, pass, content] of COURSES) insCourse.run(code, icon, crit, pass, JSON.stringify(content));
  });
  // Startvorlagen je Filiale (Manager kann sie danach ändern, sortieren, abschalten)
  for (const b of db.prepare('SELECT id FROM branches').all()) seedTemplates(db, b.id);
}

function idBy(db, table, code) {
  return db.prepare(`SELECT id FROM ${table} WHERE code = ?`).get(code)?.id ?? null;
}

export function seedTemplates(db, branchId) {
  const has = db.prepare('SELECT COUNT(*) AS n FROM task_templates WHERE branch_id = ?').get(branchId).n;
  if (has) return;
  const ins = db.prepare(`INSERT INTO task_templates (branch_id, shift, position, category, frequency, weekdays, month_day, icon, title, hint,
    requires_photo, measure_unit, sop_id, required_course_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const pos = { open: 0, run: 0, close: 0 };
  tx(db, () => {
    for (const [shift, cat, icon, title, hint, o = {}] of TEMPLATES) {
      pos[shift] += 10;
      ins.run(branchId, shift, pos[shift], cat, o.freq || 'daily', o.weekdays || '1234567', o.monthDay ?? null, icon,
        JSON.stringify(title), JSON.stringify(hint), o.photo ? 1 : 0, o.unit ?? null,
        o.sop ? idBy(db, 'sops', o.sop) : null, o.course ? idBy(db, 'courses', o.course) : null);
    }
  });
}

/** Fiktive Demo-Daten. Nur für DEMO_MODE (In-Memory-Datenbank). */
export function seedDemo(db) {
  seedBase(db);
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
    };
    const halle = idBy(db, 'branches', 'halle'), leuna = idBy(db, 'branches', 'leuna');
    const mem = db.prepare('INSERT INTO memberships (user_id, branch_id, role) VALUES (?,?,?)');
    mem.run(users.mgrHalle, halle, 'manager');
    mem.run(users.mgrLeuna, leuna, 'manager');
    mem.run(users.trainer, halle, 'trainer');
    mem.run(users.trainer, leuna, 'trainer');
    mem.run(users.empHalle, halle, 'employee');
    mem.run(users.empLeuna, leuna, 'employee');
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

    // Demo-Mitarbeiter A hat Hygiene bestanden; Fritteuse noch nicht -> Fritteusen-Aufgaben gesperrt (Qualifikationsprüfung sichtbar).
    const hyg = idBy(db, 'courses', 'C-HYGIENE');
    db.prepare("INSERT INTO exam_attempts (user_id, course_id, course_version, branch_id, lang, score, total, passed, answers) VALUES (?,?,1,?,'de',3,3,1,'[1,0,2]')").run(users.empHalle, hyg, halle);
    db.prepare("INSERT INTO course_progress (user_id, course_id, course_version, lang, steps_done) VALUES (?,?,1,'de',3)").run(users.empHalle, hyg);
  });
}
