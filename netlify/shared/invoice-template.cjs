const jspdf=require('./jspdf.cjs');
const qrcode=require('./qrcode.cjs');
const {TT_LOGO,TT_FONT_SERIF,TT_FONT_SERIF_B,TT_FONT_SANS}=require('./invoice-assets.cjs');
(function(){
  'use strict';

  var GOLD = [212,160,23], BAND = [77,77,77], LIGHT = [246,244,239],
      INK = [17,17,17], MUT = [122,116,104], LINE = [227,221,210];
  var M = 12, PW = 210, W = PW - 2*M; // okraje 12 mm, šířka obsahu 186 mm

  function money(n){
    return n.toLocaleString('cs-CZ', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' Kč';
  }
  function qty(n){
    return n.toLocaleString('cs-CZ', {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  function buildPdf(dataOverride){
    var data = dataOverride; if(!data) throw Error('Invoice data required');
    var d = new jspdf.jsPDF({unit:'mm', format:'a4'});

    d.addFileToVFS('TTSerif.ttf', TT_FONT_SERIF);
    d.addFont('TTSerif.ttf', 'TTSerif', 'normal');
    d.addFileToVFS('TTSerifB.ttf', TT_FONT_SERIF_B);
    d.addFont('TTSerifB.ttf', 'TTSerif', 'bold');
    d.addFileToVFS('TTSans.ttf', TT_FONT_SANS);
    d.addFont('TTSans.ttf', 'TTSans', 'normal');

    function label(txt, x, y, opts){
      opts = opts || {};
      d.setFont('TTSans','normal'); d.setFontSize(6.6);
      d.setTextColor(MUT[0],MUT[1],MUT[2]);
      var cs = 0.5, T = txt.toUpperCase();
      if (opts.align === 'right' || opts.align === 'center'){
        /* jsPDF nezapočítává charSpace do zarovnání — šířku spočítáme ručně */
        var w = d.getTextWidth(T) + cs * (T.length - 1);
        d.text(T, opts.align === 'right' ? x - w : x - w/2, y, {charSpace:cs});
      } else {
        d.text(T, x, y, {charSpace:cs});
      }
    }

    /* ---------- záhlaví ---------- */
    var hy = M, hh = 26;
    d.setDrawColor(GOLD[0],GOLD[1],GOLD[2]);
    d.setLineWidth(0.6);
    d.line(M, hy + hh, M + W, hy + hh);

    if(!data.test) d.addImage(TT_LOGO, 'PNG', M + 4, hy + 3, 20, 20);

    var lx = data.test ? M + 4 : M + 28;
    d.setFont('TTSans','normal'); d.setFontSize(5.6);
    d.text(data.test ? 'FIKTIVNÍ TESTOVACÍ DOKLAD' : 'ART COLLECTION', lx, hy + 9, {charSpace:1.2});
    d.setFont('TTSerif','normal'); d.setFontSize(13);
    d.setTextColor(INK[0],INK[1],INK[2]);
    d.text(data.test ? 'TESTOVACÍ DODAVATEL' : 'TULEC TREND', lx, hy + 15.4, {charSpace:1});
    d.setFont('TTSans','normal'); d.setFontSize(5.4);
    d.setTextColor(MUT[0],MUT[1],MUT[2]);
    d.text(data.test ? '— TEST – NEHRADIT —' : '— PHOTOGRAPHY · SINCE 1993 —', lx, hy + 20.4, {charSpace:0.9});

    d.setFont('TTSans','normal'); d.setFontSize(6.6);
    d.setTextColor(GOLD[0],GOLD[1],GOLD[2]);
    var fT = data.test ? 'TESTOVACÍ DOKLAD' : 'FAKTURA', fW = d.getTextWidth(fT) + 1.4 * (fT.length - 1);
    d.text(fT, M + W - 5 - fW, hy + 9.5, {charSpace:1.4});
    d.setFont('TTSerif','bold'); d.setFontSize(16);
    d.text(data.num, M + W - 5, hy + 17.5, {align:'right'});

    /* ---------- dodavatel / odběratel ---------- */
    var py = hy + hh + 9;
    var supplier = data.test
      ? ['Testovací dodavatel','Fiktivní 456, 779 00 Vzorové Město','Česká republika',
         'IČO: 00000000','Pouze testovací údaje.','test@example.invalid','example.invalid']
      : ['Tomáš Tulec','Hněvotín 406, 783 47 Hněvotín','Česká republika',
         'IČO: 66195284','Nejsme plátci DPH.',
         'foto@tulectrend.cz · 603 246 860','www.tulectrendfoto.cz'];
    var customer = data.cust.length ? data.cust : ['—'];
    var colW = W/2 - 4, cx = M + W/2 + 4;
    var lh = 4.4; customer=customer.flatMap(function(line,i){d.setFont('TTSerif',i===0?'bold':'normal');d.setFontSize(i===0?9.6:8.8);return d.splitTextToSize(line,colW-6);});

    function party(title, lines, x){
      label(title, x, py);
      var yy = py + 4;
      var blockH = lines.length * lh;
      d.setFillColor(GOLD[0],GOLD[1],GOLD[2]);
      d.rect(x, yy - 3, 0.9, blockH + 1.5, 'F');
      lines.forEach(function(ln, i){
        d.setFont('TTSerif', i === 0 ? 'bold' : 'normal');
        d.setFontSize(i === 0 ? 9.6 : 8.8);
        d.setTextColor(INK[0],INK[1],INK[2]);
        var wrapped = d.splitTextToSize(ln, colW - 6);
        d.text(wrapped[0], x + 4, yy + i*lh);
      });
      return blockH;
    }
    var h1 = party('Dodavatel', supplier, M);
    var h2 = party('Odběratel', customer, cx);
    py += 6 + Math.max(h1, h2);

    /* ---------- datumy ---------- */
    d.setFont('TTSerif','normal'); d.setFontSize(9);
    d.setTextColor(INK[0],INK[1],INK[2]);
    d.text('Datum vystavení: ', M, py);
    var w1 = d.getTextWidth('Datum vystavení: ');
    d.setFont('TTSerif','bold'); d.text(data.iss, M + w1, py);
    d.setFont('TTSerif','normal');
    d.text('Datum splatnosti: ', M + 60, py);
    var w2 = d.getTextWidth('Datum splatnosti: ');
    d.setFont('TTSerif','bold'); d.text(data.due, M + 60 + w2, py);

    /* ---------- platební sekce s QR ---------- */
    var by = py + 5, bh = 36;
    d.setFillColor(LIGHT[0],LIGHT[1],LIGHT[2]);
    d.rect(M, by, W, bh, 'F');
    d.setDrawColor(LINE[0],LINE[1],LINE[2]); d.setLineWidth(0.2);
    d.rect(M, by, W, bh, 'S');

    var pay = data.test ? [
      ['Účet: ', 'TEST – NEPOUŽÍVAT'],
      ['IBAN: ', 'FIKTIVNÍ ÚDAJ'],
      ['SWIFT: ', 'FIKTIVNÍ ÚDAJ'],
      ['Variabilní symbol: ', data.num],
      ['Konstantní symbol: ', '—'],
      ['Způsob platby: ', 'NEHRADIT']
    ] : [
      ['Účet: ', '226152322/0600'],
      ['IBAN: ', 'CZ75 0600 0000 0002 2615 2322'],
      ['SWIFT: ', 'AGBACZPP'],
      ['Variabilní symbol: ', data.num],
      ['Konstantní symbol: ', '0308'],
      ['Způsob platby: ', 'Převodem']
    ];
    var pyy = by + 7;
    pay.forEach(function(row){
      d.setFont('TTSerif','bold'); d.setFontSize(8);
      d.setTextColor(INK[0],INK[1],INK[2]);
      d.text(row[0], M + 5, pyy);
      var lw = d.getTextWidth(row[0]);
      d.setFont('TTSerif','normal');
      d.text(row[1], M + 5 + lw, pyy);
      pyy += 4.7;
    });

    /* QR kód — vektorově, modul po modulu */
    var qsize = 28, quiet = 4;
    var qx = M + W - 6 - qsize, qy = by + (bh - qsize)/2 - 1;
    d.setFillColor(255,255,255);
    d.rect(qx, qy, qsize, qsize, 'F');
    if(data.test){
      d.setDrawColor(176,74,58); d.setLineWidth(0.6);
      d.rect(qx, qy, qsize, qsize, 'S');
      d.setFont('TTSerif','bold'); d.setFontSize(9); d.setTextColor(176,74,58);
      d.text(['TEST','NEHRADIT'], qx + qsize/2, qy + 12, {align:'center'});
      label('Bez QR platby', qx + qsize/2, qy + qsize + 3, {align:'center'});
    }else{
      var qr = qrcode(0, 'M');
      qr.addData(data.spd);
      qr.make();
      var n = qr.getModuleCount();
      var cell = qsize / (n + 2*quiet);
      d.setFillColor(0,0,0);
      for (var r = 0; r < n; r++){
        for (var c = 0; c < n; c++){
          if (qr.isDark(r, c)){
            d.rect(qx + (c + quiet)*cell, qy + (r + quiet)*cell, cell, cell, 'F');
          }
        }
      }
      label('QR Platba+F', qx + qsize/2, qy + qsize + 3, {align:'center'});
    }

    var ax = qx - 8;
    label('K úhradě', ax, by + 13, {align:'right'});
    d.setFont('TTSerif','bold'); d.setFontSize(13);
    d.setTextColor(INK[0],INK[1],INK[2]);
    d.text(money(data.total), ax, by + 20, {align:'right'});

    /* ---------- tabulka položek ---------- */
    var ty = by + bh + 9;
    d.setFont('TTSerif','normal'); d.setFontSize(8.6);
    d.setTextColor(MUT[0],MUT[1],MUT[2]);
    d.text('Fakturujeme Vám za dodané zboží či služby:', M, ty);
    ty += 5;

    var cQty = M + 118, cPrice = M + 152, cTot = M + W - 2;
    label('Označení dodávky', M + 1, ty);
    label('Počet m. j.', cQty, ty, {align:'right'});
    label('Cena za m. j.', cPrice, ty, {align:'right'});
    label('Celkem', cTot, ty, {align:'right'});
    d.setDrawColor(INK[0],INK[1],INK[2]); d.setLineWidth(0.5);
    d.line(M, ty + 1.8, M + W, ty + 1.8);
    ty += 7;

    d.setFont('TTSerif','normal'); d.setFontSize(9);
    d.setTextColor(INK[0],INK[1],INK[2]);
    data.items.forEach(function(it){
      var desc = d.splitTextToSize(it.d || '—', 100);
      d.text(desc, M + 1, ty);
      d.text(qty(it.q), cQty, ty, {align:'right'});
      d.text(qty(it.p), cPrice, ty, {align:'right'});
      d.text(qty(it.q * it.p), cTot, ty, {align:'right'});
      d.setDrawColor(LINE[0],LINE[1],LINE[2]); d.setLineWidth(0.2);
      d.line(M, ty + 2.2+(desc.length-1)*4, M + W, ty + 2.2+(desc.length-1)*4);
      ty += Math.max(6.6,desc.length*4+2.6);
    });

    /* ---------- celkem ---------- */
    ty += 4;
    var tbW = 66, tbH = 15;
    d.setDrawColor(GOLD[0],GOLD[1],GOLD[2]);
    d.setLineWidth(0.6);
    d.line(M + W - tbW, ty, M + W, ty);
    label('Celkem k úhradě', M + W, ty + 5.6, {align:'right'});
    d.setFont('TTSerif','bold'); d.setFontSize(13);
    d.setTextColor(INK[0],INK[1],INK[2]);
    d.text(money(data.total), M + W, ty + 12.6, {align:'right'});

    /* ---------- poznámka + zápatí ---------- */
    d.setFont('TTSerif','normal'); d.setFontSize(8.2);
    d.setTextColor(MUT[0],MUT[1],MUT[2]);
    d.text(data.test ? 'TEST – NEHRADIT. Fiktivní doklad bez účetních a platebních účinků.' :
      'Nejsme plátci DPH. Faktura slouží zároveň jako dodací list.', M, ty + tbH + 8);

    var fy = 297 - M - 9;
    d.setFillColor(LIGHT[0],LIGHT[1],LIGHT[2]);
    d.rect(M, fy, W, 9, 'F');
    d.setFont('TTSans','normal'); d.setFontSize(7);
    var today = new Date(data.generatedOn + 'T12:00:00Z');
    var dd = String(today.getUTCDate()).padStart(2,'0') + '.' +
             String(today.getUTCMonth()+1).padStart(2,'0') + '.' + today.getUTCFullYear();
    d.text(data.test ? 'Vytvořeno pouze pro technickou zkoušku, ' + dd : 'Vystavil: Tomáš Tulec, ' + dd, M + 4, fy + 5.6);
    d.text(data.test ? 'TEST – NEHRADIT' : 'Tulec Trend Photography — www.tulectrendfoto.cz', M + W - 4, fy + 5.6, {align:'right'});

    if(data.test){
      d.setFont('TTSerif','bold'); d.setFontSize(31); d.setTextColor(225,218,210);
      d.text('TEST – NEHRADIT', PW/2, 188, {align:'center', angle:45});
    }

    return d;
  }

  module.exports = buildPdf;
})();
