/**
 * ШЕВРОНИ · ФІНАНСИ — дашборд + форма вводу операцій
 * ─────────────────────────────────────────────────────
 * Встановлення:
 *   1. У таблиці: Розширення → Apps Script
 *   2. Вміст Code.gs замініть цим файлом
 *   3. Файл → Створити → HTML, назвіть Form, вставте вміст Form.html
 *   4. Збережіть (Ctrl+S), оновіть сторінку таблиці
 *   5. З'явиться меню «⚡ Шеврони» → «Перебудувати дашборд» (перший запуск
 *      попросить дозволи — це нормально, скрипт працює лише з цією таблицею)
 *
 * Джерело даних — аркуш «Журнал». Дашборд побудований на формулах,
 * тож оновлюється сам після кожного нового запису.
 */

const SHEET_JOURNAL = 'Журнал';
const SHEET_DASH    = 'Дашборд';
const SHEET_CALC    = '_розрахунки';
const SHEET_REF     = 'Довідник';

const MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
                'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const MGEN = {'Січень':'січня','Лютий':'лютого','Березень':'березня','Квітень':'квітня',
  'Травень':'травня','Червень':'червня','Липень':'липня','Серпень':'серпня',
  'Вересень':'вересня','Жовтень':'жовтня','Листопад':'листопада','Грудень':'грудня'};

const EXP_CATS = ['Матеріали','Зарплата','Реклама','Операційні','Інше'];
const INC_CATS = ['Instagram','Оптом','Термінове','Корпоративне','Інше'];
const DEFAULT_BUDGET = {'Матеріали':50000,'Зарплата':65000,'Реклама':15000,'Операційні':5000,'Інше':15000};
const CAT_COLORS = {'Матеріали':'#2a78d6','Зарплата':'#008300','Реклама':'#e87ba4','Операційні':'#1baf7a','Інше':'#eda100'};

const C = {violet:'#7c3aed', violetDark:'#5b21b6', violetDeep:'#211056',
  inc:'#10b981', exp:'#3b82f6',
  good:'#159447', goodBg:'#e3f6ea', warn:'#c47f00', warnBg:'#fdf1da', bad:'#dc3d51', badBg:'#fdeaed',
  ink:'#16112b', ink2:'#5b5773', muted:'#8f8ba3', line:'#e6e4f0', bg:'#f2f2f9', soft:'#f6f6fb', white:'#ffffff'};

/* ───────────────────────── меню та форма ───────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('⚡ Шеврони')
    .addItem('➕ Додати операцію', 'showForm')
    .addItem('🔄 Перебудувати дашборд', 'buildDashboard')
    .addToUi();
}

function showForm() {
  const html = HtmlService.createHtmlOutputFromFile('Form')
    .setTitle('Нова операція').setWidth(330);
  SpreadsheetApp.getUi().showSidebar(html);
}

/** Викликається з форми. o = {type, date:'YYYY-MM-DD', sum, cat, note} */
function addTx(o) {
  if (!o || !o.date || !o.sum || +o.sum <= 0) throw new Error('Вкажіть дату і суму більше 0');
  if (!o.cat) throw new Error('Оберіть категорію');
  const type = o.type === 'Дохід' ? 'Дохід' : 'Витрата';

  const p = o.date.split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0);
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_JOURNAL);
  if (!sh) throw new Error('Не знайдено аркуш «' + SHEET_JOURNAL + '»');

  // останній заповнений рядок за колонкою B (Дата)
  const colB = sh.getRange(1, 2, sh.getMaxRows(), 1).getValues();
  let last = 1;
  for (let i = colB.length - 1; i >= 1; i--) if (colB[i][0] !== '') { last = i + 1; break; }
  if (last + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 20);

  const row = [
    'TX' + Date.now(),                       // A ID
    d,                                       // B Дата
    'Т' + isoWeek_(d),                       // C Тиждень
    MONTHS[d.getMonth()] + ' ' + d.getFullYear(), // D Місяць
    type,                                    // E Тип
    o.cat,                                   // F Категорія
    '',                                      // G Підкатегорія
    +o.sum,                                  // H Сума
    '', '', '',                              // I, J, K
    (o.note || '').toString().trim(),        // L Примітка
    ''                                       // M
  ];
  sh.getRange(last + 1, 1, 1, row.length).setValues([row]);
  sh.getRange(last + 1, 2).setNumberFormat('dd.mm.yyyy');
  sh.getRange(last + 1, 8).setNumberFormat('#,##0" ₴"');
  return {ok: true, msg: type + ' ' + Utilities.formatString('%s', o.sum) + ' ₴ додано'};
}

function isoWeek_(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const f = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - f) / 86400000 - 3 + ((f.getUTCDay() + 6) % 7)) / 7);
}

/* ───────────────────────── побудова ───────────────────────── */

function buildDashboard() {
  const ss = SpreadsheetApp.getActive();
  ensureBudgets_(ss);
  ensureValidation_(ss);
  buildCalc_(ss);
  buildDash_(ss);
  ss.toast('Дашборд готовий ✓', '⚡ Шеврони', 5);
}

/** Блок лімітів у Довіднику (D2:E7) — редагуйте ліміти прямо там */
function ensureBudgets_(ss) {
  let sh = ss.getSheetByName(SHEET_REF);
  if (!sh) sh = ss.insertSheet(SHEET_REF);
  if (sh.getRange('D2').getValue() !== 'ЛІМІТИ НА МІСЯЦЬ') {
    sh.getRange('D2:E2').setValues([['ЛІМІТИ НА МІСЯЦЬ', 'грн']])
      .setFontWeight('bold').setBackground(C.violet).setFontColor(C.white);
    const rows = EXP_CATS.map(c => [c, DEFAULT_BUDGET[c]]);
    sh.getRange(3, 4, rows.length, 2).setValues(rows);
    sh.getRange(3, 5, rows.length, 1).setNumberFormat('#,##0');
    sh.setColumnWidth(4, 140);
  }
}

/** Випадні списки в Журналі: Тип (E) і Категорія (F) */
function ensureValidation_(ss) {
  const sh = ss.getSheetByName(SHEET_JOURNAL);
  if (!sh) return;
  if (sh.getMaxRows() < 1001) sh.insertRowsAfter(sh.getMaxRows(), 1001 - sh.getMaxRows());
  const n = sh.getMaxRows() - 1;
  const vType = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Дохід', 'Витрата'], true).setAllowInvalid(false).build();
  const union = EXP_CATS.concat(INC_CATS.filter(c => EXP_CATS.indexOf(c) < 0));
  const vCat = SpreadsheetApp.newDataValidation()
    .requireValueInList(union, true).setAllowInvalid(true).build();
  sh.getRange(2, 5, n, 1).setDataValidation(vType);
  sh.getRange(2, 6, n, 1).setDataValidation(vCat);
}

/** Прихований аркуш з усіма агрегаціями (формули → живі дані) */
function buildCalc_(ss) {
  let sh = ss.getSheetByName(SHEET_CALC);
  if (sh) sh.clear(); else sh = ss.insertSheet(SHEET_CALC);

  const J = SHEET_JOURNAL;
  const H = J + '!$H$2:$H$5000', E = J + '!$E$2:$E$5000',
        D = J + '!$D$2:$D$5000', F = J + '!$F$2:$F$5000',
        Cw = J + '!$C$2:$C$5000', B = J + '!$B$2:$B$5000';

  // Рік дашборда — рік останнього запису журналу
  sh.getRange('V1').setValue('Рік');
  sh.getRange('V2').setFormula('=IFERROR(YEAR(MAX(' + B + ')),YEAR(TODAY()))');

  // ── Місяці (A:D)
  sh.getRange('A1:D1').setValues([['Місяць', 'Дохід', 'Витрати', 'Прибуток']]);
  const mRows = MONTHS.map((m, i) => ['="' + m + ' "&$V$2',
    '=SUMIFS(' + H + ',' + E + ',"Дохід",' + D + ',$A' + (i + 2) + ')',
    '=SUMIFS(' + H + ',' + E + ',"Витрата",' + D + ',$A' + (i + 2) + ')',
    '=B' + (i + 2) + '-C' + (i + 2)]);
  sh.getRange(2, 1, 12, 4).setFormulas(mRows);

  // ── Тижні (F:I) + компактно лише активні (K:L)
  sh.getRange('F1:I1').setValues([['Тиждень', 'Дохід', 'Витрати', 'Прибуток']]);
  const wRows = [];
  for (let w = 1; w <= 53; w++) {
    const r = w + 1;
    wRows.push(['="Т"&' + w,
      '=SUMIFS(' + H + ',' + E + ',"Дохід",' + Cw + ',$F' + r + ')',
      '=SUMIFS(' + H + ',' + E + ',"Витрата",' + Cw + ',$F' + r + ')',
      '=G' + r + '-H' + r]);
  }
  sh.getRange(2, 6, 53, 4).setFormulas(wRows);
  sh.getRange('K1:L1').setValues([['Тиждень', 'Прибуток']]);
  sh.getRange('K2').setFormula(
    '=IFERROR(QUERY({$F$2:$I$54},"select Col1, Col4 where Col2>0 or Col3>0",0),"")');

  // ── Накопичений баланс (P:R)
  sh.getRange('P1:R1').setValues([['Дата', 'Рух', 'Баланс']]);
  sh.getRange('P2').setFormula(
    '=IFERROR(SORT(FILTER({' + B + ',IF(' + E + '="Дохід",1,-1)*' + H + '},' + B + '<>""),1,TRUE),"")');
  const rFormulas = [];
  for (let i = 2; i <= 600; i++) rFormulas.push(['=IF($P' + i + '="","",SUM($Q$2:$Q' + i + '))']);
  sh.getRange(2, 18, rFormulas.length, 1).setFormulas(rFormulas);
  sh.getRange('P2:P600').setNumberFormat('dd.mm');

  // ── Підсумки та MoM (W)
  const setF = (a1, f) => sh.getRange(a1).setFormula(f);
  setF('W1', '=SUM($B$2:$B$13)');                       // дохід за рік
  setF('W2', '=SUM($C$2:$C$13)');                       // витрати за рік
  setF('W3', '=$W$1-$W$2');                              // прибуток
  setF('W4', '=IF($W$1=0,0,$W$3/$W$1)');                 // маржа
  setF('W5', '=IFERROR(SUMPRODUCT(MAX((($B$2:$B$13+$C$2:$C$13)>0)*ROW($B$2:$B$13))),0)');            // рядок останнього активного місяця
  setF('W6', '=IFERROR(SUMPRODUCT(MAX((($B$2:$B$13+$C$2:$C$13)>0)*(ROW($B$2:$B$13)<$W$5)*ROW($B$2:$B$13))),0)'); // рядок попереднього
  setF('W7', '=IF($W$5=0,"",INDEX($A:$A,$W$5))');        // назва останнього місяця
  setF('W8', '=IF($W$6=0,"",INDEX($A:$A,$W$6))');        // назва попереднього

  // Родовий відмінок місяців (Z:AA) для підписів дельт
  const gen = MONTHS.map(m => [m, MGEN[m]]);
  sh.getRange(1, 26, gen.length, 2).setValues(gen);      // Z1:AA12
  setF('W9', '=IF($W$8="","",VLOOKUP(REGEXEXTRACT($W$8,"^\\S+"),$Z:$AA,2,FALSE))'); // «червня»

  const delta = (lastF, prevF, invert) =>
    '=IF(OR($W$6=0,' + prevF + '=0),"",' +
    'IF(' + lastF + '>=' + prevF + ',"▲ ","▼ ")&TEXT(ABS(' + lastF + '-' + prevF + ')/' + prevF + ',"0%")&' +
    '" до "&$W$9)';
  setF('W10', '=IF($W$5=0,0,INDEX($B:$B,$W$5))');  // дохід останнього міс.
  setF('W11', '=IF($W$6=0,0,INDEX($B:$B,$W$6))');
  setF('W12', '=IF($W$5=0,0,INDEX($C:$C,$W$5))');  // витрати
  setF('W13', '=IF($W$6=0,0,INDEX($C:$C,$W$6))');
  setF('W14', '=IF($W$5=0,0,INDEX($D:$D,$W$5))');  // прибуток
  setF('W15', '=IF($W$6=0,0,INDEX($D:$D,$W$6))');
  setF('X1', delta('$W$10', '$W$11'));                                  // дельта доходу
  setF('X2', delta('$W$12', '$W$13'));                                  // дельта витрат
  setF('X3', '=IF($W$6=0,"",IF($W$14>=$W$15,"▲ +","▼ −")&TEXT(ABS($W$14-$W$15),"#,##0")&" ₴ до "&$W$9)'); // дельта прибутку, абсолютна

  // ── Структура витрат за рік (AC:AD)
  sh.getRange('AC1:AD1').setValues([['Категорія', 'Сума']]);
  EXP_CATS.forEach((c, i) => {
    sh.getRange(i + 2, 29).setValue(c);
    sh.getRange(i + 2, 30).setFormula('=SUMIFS(' + H + ',' + E + ',"Витрата",' + F + ',$AC' + (i + 2) + ')');
  });

  // ── Health Score (виправлена логіка: відсотки, а не гривні)
  setF('W20', '=IF($W$1=0,0,INDEX($AD:$AD,MATCH("Реклама",$AC:$AC,0))/$W$1)');   // реклама/дохід
  setF('W21', '=IF($W$1=0,0,INDEX($AD:$AD,MATCH("Зарплата",$AC:$AC,0))/$W$1)');  // зарплати/дохід
  setF('W22', '=IF($W$1=0,0,INDEX($AD:$AD,MATCH("Матеріали",$AC:$AC,0))/$W$1)'); // матеріали/дохід
  setF('W23', '=MAX(0,MIN(25,$W$4/0.3*25))');                                    // бал: маржа
  setF('W24', '=IF($W$20<=0.15,25,MAX(0,25-($W$20-0.15)/0.15*25))');             // бал: реклама
  setF('W25', '=IF($W$21<=0.4,25,MAX(0,25-($W$21-0.4)/0.4*25))');                // бал: зарплати
  setF('W26', '=IF($W$22<=0.3,25,MAX(0,25-($W$22-0.3)/0.3*25))');                // бал: матеріали
  setF('W27', '=ROUND($W$23+$W$24+$W$25+$W$26,0)');                              // разом

  // ── Бюджети поточного (останнього активного) місяця (AF:AI)
  sh.getRange('AF1:AI1').setValues([['Категорія', 'Витрачено', 'Ліміт', 'Частка']]);
  EXP_CATS.forEach((c, i) => {
    const r = i + 2;
    sh.getRange(r, 32).setValue(c);
    sh.getRange(r, 33).setFormula('=IF($W$7="",0,SUMIFS(' + H + ',' + E + ',"Витрата",' + D + ',$W$7,' + F + ',$AF' + r + '))');
    sh.getRange(r, 34).setFormula('=IFERROR(VLOOKUP($AF' + r + ',' + SHEET_REF + '!$D:$E,2,FALSE),0)');
    sh.getRange(r, 35).setFormula('=IF($AH' + r + '=0,0,$AG' + r + '/$AH' + r + ')');
  });

  sh.hideSheet();
}

/** Аркуш «Дашборд» — оформлення в стилі затвердженого макета */
function buildDash_(ss) {
  let sh = ss.getSheetByName(SHEET_DASH);
  if (sh) { sh.getCharts().forEach(c => sh.removeChart(c)); sh.clear(); sh.clearConditionalFormatRules(); }
  else sh = ss.insertSheet(SHEET_DASH, 0);
  const K = "'" + SHEET_CALC + "'!";

  sh.setHiddenGridlines(true);
  sh.getRange('A1:M60').setBackground(C.bg).setFontFamily('Roboto').setFontColor(C.ink);
  const widths = [18, 120, 95, 120, 95, 120, 95, 120, 95, 120, 95, 120, 18];
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));

  // ── Шапка
  sh.getRange('B2:L2').merge().setValue('⚡ ШЕВРОНИ · ФІНАНСИ')
    .setBackground(C.violetDeep).setFontColor(C.white).setFontSize(16).setFontWeight('bold')
    .setVerticalAlignment('middle');
  sh.setRowHeight(2, 44);
  sh.getRange('B3:L3').merge()
    .setFormula('="Дашборд оновлюється автоматично з «Журналу» · рік "&' + K + 'V2')
    .setFontColor(C.muted).setFontSize(9);

  // ── KPI-картки (рядки 5–8)
  const cards = [
    {c: 2, label: 'ЧИСТИЙ ПРИБУТОК · РІК', val: '=' + K + 'W3', fmt: '#,##0" ₴"',
     meta: '=' + K + 'X3', hero: true},
    {c: 4, label: 'ДОХІД · РІК', val: '=' + K + 'W1', fmt: '#,##0" ₴"', meta: '=' + K + 'X1', ac: C.inc},
    {c: 6, label: 'ВИТРАТИ · РІК', val: '=' + K + 'W2', fmt: '#,##0" ₴"', meta: '=' + K + 'X2', ac: C.exp},
    {c: 8, label: 'МАРЖА', val: '=' + K + 'W4', fmt: '0%',
     meta: '=IF(' + K + 'W4>=0.3,"здорова · ціль 30%","нижче цілі 30%")', ac: C.warn},
    {c: 10, label: 'HEALTH SCORE', val: '=' + K + 'W27', fmt: '0"/100"',
     meta: '=IF(' + K + 'W27>=75,"✅ бізнес здоровий",IF(' + K + 'W27>=50,"⚠️ є ризики","🛑 потрібна увага"))', ac: C.violet}
  ];
  sh.setRowHeight(5, 22); sh.setRowHeight(6, 34); sh.setRowHeight(7, 20); sh.setRowHeight(8, 8);
  cards.forEach(cd => {
    const rg = sh.getRange(5, cd.c, 3, 2);
    rg.setBackground(cd.hero ? C.violet : C.white);
    rg.setBorder(true, true, true, true, false, false, cd.hero ? C.violetDark : C.line,
      SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(5, cd.c, 1, 2).merge().setValue(cd.label)
      .setFontSize(8).setFontWeight('bold')
      .setFontColor(cd.hero ? '#e6dcff' : C.ink2);
    sh.getRange(6, cd.c, 1, 2).merge().setFormula(cd.val)
      .setFontSize(18).setFontWeight('bold').setNumberFormat(cd.fmt)
      .setFontColor(cd.hero ? C.white : (cd.ac || C.ink));
    sh.getRange(7, cd.c, 1, 2).merge().setFormula(cd.meta)
      .setFontSize(8).setFontColor(cd.hero ? '#e6dcff' : C.muted);
  });

  // ── Структура витрат за рік (зліва) + Бюджети місяця (справа), рядки 10–16
  sh.getRange('B10').setValue('СТРУКТУРА ВИТРАТ · РІК')
    .setFontWeight('bold').setFontSize(10).setFontColor(C.ink);
  sh.getRange('B11:E11').setValues([['Категорія', 'Сума', '%', '']])
    .setFontSize(8).setFontWeight('bold').setFontColor(C.muted).setBackground(C.soft);
  EXP_CATS.forEach((cat, i) => {
    const r = 12 + i, cr = i + 2;
    sh.getRange(r, 2).setValue(cat).setFontColor(CAT_COLORS[cat]).setFontWeight('bold').setFontSize(9);
    sh.getRange(r, 3).setFormula('=' + K + 'AD' + cr).setNumberFormat('#,##0" ₴"').setFontSize(9);
    sh.getRange(r, 4).setFormula('=IF(' + K + 'W2=0,0,' + K + 'AD' + cr + '/' + K + 'W2)')
      .setNumberFormat('0%').setFontSize(9).setFontColor(C.ink2);
    sh.getRange(r, 5).setFormula(
      '=IFERROR(SPARKLINE(' + K + 'AD' + cr + ',{"charttype","bar";"max",MAX(' + K + '$AD$2:$AD$6);"color1","' +
      CAT_COLORS[cat] + '"}),"")');
    sh.getRange(r, 2, 1, 4).setBackground(C.white)
      .setBorder(null, null, true, null, null, null, C.line, SpreadsheetApp.BorderStyle.SOLID);
  });

  sh.getRange('G10').setFormula('="БЮДЖЕТИ · "&UPPER(IF(' + K + 'W7="","—",' + K + 'W7))')
    .setFontWeight('bold').setFontSize(10);
  sh.getRange('G11:L11').setValues([['Категорія', 'Витрачено', 'Ліміт', '%', 'Статус', '']])
    .setFontSize(8).setFontWeight('bold').setFontColor(C.muted).setBackground(C.soft);
  EXP_CATS.forEach((cat, i) => {
    const r = 12 + i, cr = i + 2;
    sh.getRange(r, 7).setValue(cat).setFontWeight('bold').setFontSize(9).setFontColor(CAT_COLORS[cat]);
    sh.getRange(r, 8).setFormula('=' + K + 'AG' + cr).setNumberFormat('#,##0').setFontSize(9);
    sh.getRange(r, 9).setFormula('=' + K + 'AH' + cr).setNumberFormat('#,##0').setFontSize(9).setFontColor(C.muted);
    sh.getRange(r, 10).setFormula('=' + K + 'AI' + cr).setNumberFormat('0%').setFontSize(9);
    sh.getRange(r, 11).setFormula(
      '=IF(' + K + 'AI' + cr + '>1,"перевищено",IF(' + K + 'AI' + cr + '>=0.8,"увага","у межах"))')
      .setFontSize(8).setFontWeight('bold').setHorizontalAlignment('center');
    sh.getRange(r, 12).setFormula(
      '=IFERROR(SPARKLINE(MIN(' + K + 'AI' + cr + ',1),{"charttype","bar";"max",1;"color1",' +
      'IF(' + K + 'AI' + cr + '>1,"' + C.bad + '",IF(' + K + 'AI' + cr + '>=0.8,"' + C.warn + '","' + C.good + '"))}),"")');
    sh.getRange(r, 7, 1, 6).setBackground(C.white)
      .setBorder(null, null, true, null, null, null, C.line, SpreadsheetApp.BorderStyle.SOLID);
  });
  sh.getRange('G17').setValue('Ліміти редагуються на аркуші «Довідник» (колонки D:E)')
    .setFontSize(8).setFontColor(C.muted);

  // Умовне форматування статусів бюджету
  const stR = sh.getRange('K12:K16');
  const rules = [
    ['перевищено', C.badBg, C.bad], ['увага', C.warnBg, C.warn], ['у межах', C.goodBg, C.good]
  ].map(([t, bg, fc]) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(t).setBackground(bg).setFontColor(fc).setRanges([stR]).build());
  sh.setConditionalFormatRules(rules);

  // ── Health-деталі (рядки 19–24, зліва)
  sh.getRange('B19').setValue("ФІНАНСОВЕ ЗДОРОВ'Я · ДЕТАЛІ")
    .setFontWeight('bold').setFontSize(10);
  const hRows = [
    ['Маржинальність', 'W4', 'W23', 'ціль > 30%'],
    ['Реклама / дохід', 'W20', 'W24', 'ціль ≤ 15%'],
    ['Зарплати / дохід', 'W21', 'W25', 'ціль ≤ 40%'],
    ['Матеріали / дохід', 'W22', 'W26', 'ціль ≤ 30%']
  ];
  sh.getRange('B20:F20').setValues([['Показник', 'Значення', 'Бал', 'Ціль', '']])
    .setFontSize(8).setFontWeight('bold').setFontColor(C.muted).setBackground(C.soft);
  hRows.forEach((h, i) => {
    const r = 21 + i;
    sh.getRange(r, 2).setValue(h[0]).setFontSize(9).setFontWeight('bold');
    sh.getRange(r, 3).setFormula('=' + K + h[1]).setNumberFormat('0%').setFontSize(9);
    sh.getRange(r, 4).setFormula('=ROUND(' + K + h[2] + ',0)&"/25"').setFontSize(9);
    sh.getRange(r, 5).setValue(h[3]).setFontSize(8).setFontColor(C.muted);
    sh.getRange(r, 6).setFormula(
      '=IFERROR(SPARKLINE(' + K + h[2] + ',{"charttype","bar";"max",25;"color1",' +
      'IF(' + K + h[2] + '>=20,"' + C.good + '",IF(' + K + h[2] + '>=12,"' + C.warn + '","' + C.bad + '"))}),"")');
    sh.getRange(r, 2, 1, 5).setBackground(C.white)
      .setBorder(null, null, true, null, null, null, C.line, SpreadsheetApp.BorderStyle.SOLID);
  });

  // ── Діаграми
  const calc = ss.getSheetByName(SHEET_CALC);
  const monthly = sh.newChart().asColumnChart()
    .addRange(calc.getRange('A1:C13'))
    .setPosition(26, 2, 0, 0)
    .setOption('title', 'Доходи та витрати по місяцях')
    .setOption('colors', [C.inc, C.exp])
    .setOption('legend', {position: 'top'})
    .setOption('width', 560).setOption('height', 300).build();
  sh.insertChart(monthly);

  const cum = sh.newChart().asAreaChart()
    .addRange(calc.getRange('P1:P600')).addRange(calc.getRange('R1:R600'))
    .setPosition(26, 7, 0, 0)
    .setOption('title', 'Накопичений баланс (по днях)')
    .setOption('colors', [C.violet])
    .setOption('legend', {position: 'none'})
    .setOption('width', 560).setOption('height', 300).build();
  sh.insertChart(cum);

  const weekly = sh.newChart().asColumnChart()
    .addRange(calc.getRange('K1:L54'))
    .setPosition(42, 2, 0, 0)
    .setOption('title', 'Прибуток по тижнях')
    .setOption('colors', [C.violet])
    .setOption('legend', {position: 'none'})
    .setOption('width', 560).setOption('height', 280).build();
  sh.insertChart(weekly);

  ss.setActiveSheet(sh);
}
