// Weitere Pflichtschulungen. Eigene ForHuman-Inhalte, keine erfundenen Grenzwerte oder Dosierungen:
// Es wird immer auf HACCP-Plan, Etikett/Sicherheitsdatenblatt bzw. Allergenliste der Filiale verwiesen.
// Übersetzungen EN/AR/TR sind Entwürfe (reviewed_langs = 'de').
const L = (de, en, ar, tr) => ({ de, en, ar, tr });

export const EXTRA_COURSES = [
  ['C-GOODS', 'box', 0, 100, L(
    { title: 'Wareneingang & Kühlkette', intro: 'Ware kommt nur rein, wenn sie geprüft ist.',
      steps: [
        { icon: 'scan', text: 'Lieferung mit Lieferschein vergleichen. Code scannen oder Nummer eintippen.' },
        { icon: 'eye', text: 'Verpackung ansehen: kaputt, nass, offen? Dann nicht annehmen und Foto machen.' },
        { icon: 'thermo', text: 'Bei Kühlware Temperatur messen und eintragen. Grenzwerte stehen im HACCP-Plan der Filiale.' },
        { icon: 'snow', text: 'Kühlware sofort in die Kühlung. Älteste Ware nach vorne.' }],
      questions: [
        { q: 'Die Verpackung ist nass und kaputt. Was tust du?', options: ['Trotzdem annehmen', 'Foto machen und ablehnen bzw. Leitung fragen', 'Wegwerfen ohne Meldung'], correct: 1 },
        { q: 'Was machst du zuerst mit Kühlware?', image: 'snow', options: ['Später einräumen', 'Temperatur prüfen und sofort kühlen', 'In die Sonne stellen'], correct: 1 },
        { q: 'Wo stehen die Temperatur-Grenzwerte?', options: ['Im HACCP-Plan der Filiale', 'Ich schätze', 'Auf dem Lieferwagen'], correct: 0 }] },
    { title: 'Goods receipt & cold chain', intro: 'Goods only come in after checking.',
      steps: [
        { icon: 'scan', text: 'Compare the delivery with the delivery note. Scan the code or type the number.' },
        { icon: 'eye', text: 'Check the packaging: broken, wet, open? Then do not accept and take a photo.' },
        { icon: 'thermo', text: 'For chilled goods measure and enter the temperature. Limits are in the branch HACCP plan.' },
        { icon: 'snow', text: 'Put chilled goods into the fridge at once. Oldest stock to the front.' }],
      questions: [
        { q: 'The packaging is wet and broken. What do you do?', options: ['Accept anyway', 'Take a photo and reject or ask the manager', 'Throw away without reporting'], correct: 1 },
        { q: 'What do you do first with chilled goods?', image: 'snow', options: ['Store later', 'Check temperature and chill at once', 'Put in the sun'], correct: 1 },
        { q: 'Where are the temperature limits?', options: ['In the branch HACCP plan', 'I guess', 'On the delivery van'], correct: 0 }] },
    { title: 'استلام البضاعة وسلسلة التبريد', intro: 'لا تدخل البضاعة إلا بعد الفحص.',
      steps: [
        { icon: 'scan', text: 'قارن التسليم مع إشعار التسليم. امسح الرمز أو اكتب الرقم.' },
        { icon: 'eye', text: 'افحص التغليف: مكسور أو مبلل أو مفتوح؟ لا تقبله والتقط صورة.' },
        { icon: 'thermo', text: 'للبضاعة المبردة قِس درجة الحرارة وسجّلها. الحدود في خطة HACCP للفرع.' },
        { icon: 'snow', text: 'ضع البضاعة المبردة في التبريد فورًا. الأقدم إلى الأمام.' }],
      questions: [
        { q: 'التغليف مبلل ومكسور. ماذا تفعل؟', options: ['أقبله رغم ذلك', 'ألتقط صورة وأرفض أو أسأل المدير', 'أرميه بدون إبلاغ'], correct: 1 },
        { q: 'ماذا تفعل أولًا بالبضاعة المبردة؟', image: 'snow', options: ['أخزنها لاحقًا', 'أفحص الحرارة وأبرّدها فورًا', 'أضعها في الشمس'], correct: 1 },
        { q: 'أين توجد حدود درجة الحرارة؟', options: ['في خطة HACCP للفرع', 'أخمّن', 'على سيارة التوصيل'], correct: 0 }] },
    { title: 'Mal kabul ve soğuk zincir', intro: 'Mal ancak kontrol edildikten sonra alınır.',
      steps: [
        { icon: 'scan', text: 'Teslimatı irsaliye ile karşılaştır. Kodu tara veya numarayı yaz.' },
        { icon: 'eye', text: 'Ambalaja bak: kırık, ıslak, açık mı? O zaman kabul etme ve fotoğraf çek.' },
        { icon: 'thermo', text: 'Soğuk malda sıcaklığı ölç ve gir. Sınırlar şubenin HACCP planında.' },
        { icon: 'snow', text: 'Soğuk malı hemen soğutmaya koy. En eski mal öne.' }],
      questions: [
        { q: 'Ambalaj ıslak ve kırık. Ne yaparsın?', options: ['Yine de kabul ederim', 'Fotoğraf çeker, reddeder veya müdüre sorarım', 'Bildirmeden atarım'], correct: 1 },
        { q: 'Soğuk malla önce ne yaparsın?', image: 'snow', options: ['Sonra yerleştiririm', 'Sıcaklığı kontrol eder, hemen soğuturum', 'Güneşe koyarım'], correct: 1 },
        { q: 'Sıcaklık sınırları nerede yazar?', options: ['Şubenin HACCP planında', 'Tahmin ederim', 'Teslimat aracında'], correct: 0 }] })],
  ['C-CLEANING', 'spray', 0, 100, L(
    { title: 'Reinigen & Desinfizieren', intro: 'Sauber heißt sicher. Immer nach Etikett.',
      steps: [
        { icon: 'clean', text: 'Erst grob reinigen, dann desinfizieren. Schmutz verhindert, dass Desinfektion wirkt.' },
        { icon: 'spray', text: 'Dosierung und Einwirkzeit stehen auf dem Etikett und im Sicherheitsdatenblatt. Nie schätzen.' },
        { icon: 'warn', text: 'Mittel nie mischen. Handschuhe/Brille tragen, wenn das Etikett es verlangt.' },
        { icon: 'camera', text: 'Wo die App es verlangt: Foto am Ende machen.' }],
      questions: [
        { q: 'Woher weißt du die Dosierung?', options: ['Vom Etikett / Sicherheitsdatenblatt', 'Nach Gefühl', 'Je mehr, desto besser'], correct: 0 },
        { q: 'Darfst du zwei Reinigungsmittel mischen?', image: 'warn', options: ['Ja, dann wirkt es stärker', 'Nein, niemals', 'Nur am Wochenende'], correct: 1 },
        { q: 'Was kommt zuerst?', options: ['Desinfizieren', 'Grob reinigen', 'Trocknen'], correct: 1 }] },
    { title: 'Cleaning & disinfecting', intro: 'Clean means safe. Always as on the label.',
      steps: [
        { icon: 'clean', text: 'First clean off dirt, then disinfect. Dirt stops disinfection from working.' },
        { icon: 'spray', text: 'Dose and contact time are on the label and safety data sheet. Never guess.' },
        { icon: 'warn', text: 'Never mix products. Wear gloves/goggles if the label says so.' },
        { icon: 'camera', text: 'Where the app asks: take a photo at the end.' }],
      questions: [
        { q: 'Where do you find the dose?', options: ['On the label / safety data sheet', 'By feeling', 'The more the better'], correct: 0 },
        { q: 'May you mix two cleaning products?', image: 'warn', options: ['Yes, it works better', 'No, never', 'Only at weekends'], correct: 1 },
        { q: 'What comes first?', options: ['Disinfect', 'Clean off dirt', 'Dry'], correct: 1 }] },
    { title: 'التنظيف والتعقيم', intro: 'النظافة تعني الأمان. دائمًا حسب الملصق.',
      steps: [
        { icon: 'clean', text: 'نظّف الأوساخ أولًا ثم عقّم. الأوساخ تمنع التعقيم من العمل.' },
        { icon: 'spray', text: 'الجرعة ومدة التأثير على الملصق وورقة بيانات السلامة. لا تخمّن أبدًا.' },
        { icon: 'warn', text: 'لا تخلط المنتجات أبدًا. ارتدِ القفازات/النظارات إذا طلب الملصق.' },
        { icon: 'camera', text: 'حيث يطلب التطبيق: التقط صورة في النهاية.' }],
      questions: [
        { q: 'من أين تعرف الجرعة؟', options: ['من الملصق / ورقة بيانات السلامة', 'بالإحساس', 'كلما زاد كان أفضل'], correct: 0 },
        { q: 'هل يجوز خلط منظفين؟', image: 'warn', options: ['نعم، يعمل أقوى', 'لا، أبدًا', 'فقط في عطلة نهاية الأسبوع'], correct: 1 },
        { q: 'ماذا يأتي أولًا؟', options: ['التعقيم', 'تنظيف الأوساخ', 'التجفيف'], correct: 1 }] },
    { title: 'Temizlik ve dezenfeksiyon', intro: 'Temiz demek güvenli demek. Her zaman etikete göre.',
      steps: [
        { icon: 'clean', text: 'Önce kiri temizle, sonra dezenfekte et. Kir dezenfeksiyonu engeller.' },
        { icon: 'spray', text: 'Doz ve bekleme süresi etikette ve güvenlik bilgi formunda yazar. Asla tahmin etme.' },
        { icon: 'warn', text: 'Ürünleri asla karıştırma. Etiket istiyorsa eldiven/gözlük tak.' },
        { icon: 'camera', text: 'Uygulama isterse: sonunda fotoğraf çek.' }],
      questions: [
        { q: 'Dozu nereden öğrenirsin?', options: ['Etiketten / güvenlik bilgi formundan', 'Hissederek', 'Ne kadar çok o kadar iyi'], correct: 0 },
        { q: 'İki temizlik ürününü karıştırabilir misin?', image: 'warn', options: ['Evet, daha iyi etki eder', 'Hayır, asla', 'Sadece hafta sonu'], correct: 1 },
        { q: 'Önce ne gelir?', options: ['Dezenfekte etmek', 'Kiri temizlemek', 'Kurutmak'], correct: 1 }] })],
  ['C-ALLERGENS', 'warn', 0, 100, L(
    { title: 'Allergene & Gästefragen', intro: 'Bei Allergien kann ein Fehler gefährlich sein.',
      steps: [
        { icon: 'book', text: 'Allergen-Infos stehen in der freigegebenen Allergenliste der Filiale. Nur dort nachsehen.' },
        { icon: 'warn', text: 'Nicht sicher? Nie raten. Leitung holen.' },
        { icon: 'shield', text: 'Sonderwunsch wegen Allergie: Bestellung markieren, sauberes Werkzeug, Kreuzkontakt vermeiden.' }],
      questions: [
        { q: 'Ein Gast fragt nach Allergenen. Du weißt es nicht. Was tust du?', options: ['Raten', 'In der Allergenliste nachsehen oder Leitung holen', 'Sagen: ist sicher ohne'], correct: 1 },
        { q: 'Wo stehen die Allergen-Infos?', image: 'book', options: ['In der freigegebenen Allergenliste', 'Im Internet', 'Kollegen fragen reicht'], correct: 0 },
        { q: 'Was ist bei Allergie-Bestellungen wichtig?', options: ['Schneller arbeiten', 'Sauberes Werkzeug, Kreuzkontakt vermeiden', 'Nichts Besonderes'], correct: 1 }] },
    { title: 'Allergens & guest questions', intro: 'With allergies a mistake can be dangerous.',
      steps: [
        { icon: 'book', text: 'Allergen information is in the approved allergen list of the branch. Only look there.' },
        { icon: 'warn', text: 'Not sure? Never guess. Get the manager.' },
        { icon: 'shield', text: 'Special request because of allergy: mark the order, clean tools, avoid cross-contact.' }],
      questions: [
        { q: 'A guest asks about allergens. You do not know. What do you do?', options: ['Guess', 'Check the allergen list or get the manager', 'Say: it is safe'], correct: 1 },
        { q: 'Where is the allergen information?', image: 'book', options: ['In the approved allergen list', 'On the internet', 'Asking a colleague is enough'], correct: 0 },
        { q: 'What matters for allergy orders?', options: ['Work faster', 'Clean tools, avoid cross-contact', 'Nothing special'], correct: 1 }] },
    { title: 'مسببات الحساسية وأسئلة الزبائن', intro: 'مع الحساسية قد يكون الخطأ خطيرًا.',
      steps: [
        { icon: 'book', text: 'معلومات مسببات الحساسية في قائمة الفرع المعتمدة. ابحث هناك فقط.' },
        { icon: 'warn', text: 'غير متأكد؟ لا تخمّن أبدًا. نادِ المدير.' },
        { icon: 'shield', text: 'طلب خاص بسبب حساسية: علّم الطلب، أدوات نظيفة، تجنّب التلامس.' }],
      questions: [
        { q: 'زبون يسأل عن مسببات الحساسية ولا تعرف. ماذا تفعل؟', options: ['أخمّن', 'أبحث في القائمة أو أنادي المدير', 'أقول: آمن'], correct: 1 },
        { q: 'أين توجد معلومات مسببات الحساسية؟', image: 'book', options: ['في القائمة المعتمدة', 'على الإنترنت', 'يكفي سؤال زميل'], correct: 0 },
        { q: 'ما المهم في طلبات الحساسية؟', options: ['العمل بسرعة', 'أدوات نظيفة وتجنّب التلامس', 'لا شيء خاص'], correct: 1 }] },
    { title: 'Alerjenler ve misafir soruları', intro: 'Alerjide bir hata tehlikeli olabilir.',
      steps: [
        { icon: 'book', text: 'Alerjen bilgileri şubenin onaylı alerjen listesinde. Sadece oraya bak.' },
        { icon: 'warn', text: 'Emin değil misin? Asla tahmin etme. Müdürü çağır.' },
        { icon: 'shield', text: 'Alerji nedeniyle özel istek: siparişi işaretle, temiz alet, çapraz teması önle.' }],
      questions: [
        { q: 'Misafir alerjen soruyor, bilmiyorsun. Ne yaparsın?', options: ['Tahmin ederim', 'Listeye bakarım veya müdürü çağırırım', 'Güvenli derim'], correct: 1 },
        { q: 'Alerjen bilgileri nerede?', image: 'book', options: ['Onaylı alerjen listesinde', 'İnternette', 'Arkadaşa sormak yeter'], correct: 0 },
        { q: 'Alerji siparişlerinde ne önemli?', options: ['Hızlı çalışmak', 'Temiz alet, çapraz teması önlemek', 'Özel bir şey yok'], correct: 1 }] })],
];
