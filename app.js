/* Mariné Car Wash & Lounge — site script
   Talks to the existing booking API on the same server:
     GET  api/slots?date=YYYY-MM-DD   -> { slots: [{ time, availableCount, peron1Available, status }] }
     POST api/appointments            -> { appointment: { code, peron, loyaltyStamps, isFifthFree } }
     GET  api/lookup?q=...            -> { loyaltyStamps, appointments: [...] }
   If the API is unreachable the page still works: default times are shown and
   the request goes straight to WhatsApp for manual confirmation. */
(() => {
  'use strict';

  const WHATSAPP = '905459499099';
  const CODE_PREFIX = 'MRN';
  const DEFAULT_TIMES = ['09:00', '10:00', '11:00', '12:30', '14:00', '15:30', '17:00', '18:30', '20:00'];
  const PACKAGES = [
    { name: 'Mariné Standart İç-Dış Yıkama', label: 'İç-dış yıkama', base: 450, min: 45 },
    { name: 'Hydro-Shield Detaylı Yıkama', label: 'Detaylı yıkama ve sıvı seramik', base: 850, min: 75 },
    { name: 'Detaylı İç Kuaför & Buhar Sterilizasyonu', label: 'Detaylı iç temizlik', base: 3500, min: 240 }
  ];
  const SEGMENTS = [
    { name: 'Binek (Sedan / HB)', label: 'Binek', mult: 1 },
    { name: 'SUV / Crossover', label: 'SUV', mult: 1.22 },
    { name: 'Pick-Up / VIP Van', label: 'Pick-up, van', mult: 1.55 }
  ];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const price = (base, mult) => Math.round((base * mult) / 50) * 50;
  const tl = (n) => `${n.toLocaleString('tr-TR')} ₺`;
  const minutesLabel = (m) => (m >= 60 && m % 60 === 0 ? `${m / 60} saat` : `${m} dk`);
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dayFmt = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const dayLabel = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return dayFmt.format(new Date(y, m - 1, d));
  };

  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c != null) n.append(c);
    return n;
  }

  function normalizePlate(v) {
    return v.toLocaleUpperCase('tr-TR').replace(/[^0-9A-ZÇĞİÖŞÜ]/g, '').replace(/^(\d{2})([A-ZÇĞİÖŞÜ]{1,3})(\d{2,4})$/, '$1 $2 $3');
  }
  const validPlate = (v) => /^(0[1-9]|[1-7]\d|8[01]) [A-ZÇĞİÖŞÜ]{1,3} \d{2,4}$/.test(normalizePlate(v));
  function normalizePhone(v) {
    const d = v.replace(/\D/g, '');
    const local = d.replace(/^90/, '').replace(/^0/, '');
    return /^5\d{9}$/.test(local) ? `0${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6, 8)} ${local.slice(8)}` : null;
  }

  async function api(path, options) {
    const res = await fetch(path, { headers: { Accept: 'application/json', ...(options && options.body ? { 'Content-Type': 'application/json' } : {}) }, ...options });
    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON */ }
    if (!res.ok) throw Object.assign(new Error((data && data.error) || `HTTP ${res.status}`), { status: res.status, data });
    return data;
  }

  // Past times today are not bookable; give the team 30 minutes' notice.
  function isPast(iso, time) {
    const now = new Date();
    if (iso !== isoDate(now)) return false;
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m < now.getHours() * 60 + now.getMinutes() + 30;
  }

  async function loadSlots(iso) {
    try {
      const data = await api(`api/slots?date=${encodeURIComponent(iso)}`);
      const slots = (data && Array.isArray(data.slots) ? data.slots : []).map((s) => ({
        time: String(s.time),
        free: Number(s.availableCount) || 0,
        peron: s.peron1Available ? 'Peron 1' : 'Peron 2'
      }));
      return { live: true, slots: slots.map((s) => ({ ...s, past: isPast(iso, s.time) })) };
    } catch (_) {
      return { live: false, slots: DEFAULT_TIMES.map((t) => ({ time: t, free: 2, peron: '', past: isPast(iso, t) })) };
    }
  }

  function whatsappText(b) {
    return [
      'Merhaba, Mariné için randevu talebim:',
      b.code ? `Randevu kodu: ${b.code}` : null,
      `Ad soyad: ${b.name}`,
      `Telefon: ${b.phone}`,
      `Plaka: ${b.plate}`,
      `Araç: ${b.segmentLabel}`,
      `Paket: ${b.packageLabel}`,
      `Gün: ${dayLabel(b.date)}, saat ${b.time}${b.peron ? ` (${b.peron})` : ''}`,
      `Tutar: ${tl(b.total)}, ödeme tesiste`,
      b.note ? `Not: ${b.note}` : null,
      b.code ? null : 'Saat uygunluğunu teyit eder misiniz?'
    ].filter(Boolean).join('\n');
  }
  const waLink = (text) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

  async function createAppointment(b) {
    const payload = {
      customerName: b.name,
      phone: b.phone,
      plate: b.plate,
      notes: b.note || '',
      codePrefix: CODE_PREFIX,
      vehicleType: b.segment,
      packageName: b.package,
      addons: [],
      cafeItems: [],
      washPrice: b.total,
      cafePrice: 0,
      totalPrice: b.total,
      durationMin: b.minutes,
      date: b.date,
      time: b.time,
      loungeNote: b.source === 'asistan' ? 'Hızlı randevu asistanı' : (b.note || 'Web sitesi')
    };
    const data = await api('api/appointments', { method: 'POST', body: JSON.stringify(payload) });
    return (data && data.appointment) || {};
  }

  /* ---------- Header & menu ---------- */
  const header = $('#ust');
  const hero = $('.hero');
  const menuBtn = $('#menuBtn');
  const menu = $('#mobilMenu');

  function syncHeader() {
    const heroEnd = hero ? hero.offsetTop + hero.offsetHeight - header.offsetHeight : 0;
    header.classList.toggle('is-solid', window.scrollY > heroEnd || !menu.hidden);
  }
  window.addEventListener('scroll', syncHeader, { passive: true });
  window.addEventListener('resize', syncHeader);
  syncHeader();

  function setMenu(open) {
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
    syncHeader();
    if (open) $('a', menu).focus();
  }
  menuBtn.addEventListener('click', () => setMenu(menu.hidden));
  $$('[data-close]', menu).forEach((a) => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); }
  });

  /* ---------- Hero: video time follows scroll ---------- */
  (function heroVideo() {
    const video = $('#heroVideo');
    if (!hero || !video) return;
    const beats = $$('.hero-beat', hero);
    const fill = $('#heroProgress');
    const conn = navigator.connection || {};
    const big = window.innerWidth * (window.devicePixelRatio || 1) >= 1400 && !conn.saveData && !/2g/.test(conn.effectiveType || '');
    const src = big ? 'assets/video/hero-yikama-9s-1080.mp4' : 'assets/video/hero-yikama-9s-720.mp4';

    if (reduceMotion) {
      video.src = src;
      hero.classList.add('is-static');
      const btn = el('button', { type: 'button', class: 'hero-pause', text: 'Videoyu durdur' });
      btn.addEventListener('click', () => {
        if (video.paused) { video.play(); btn.textContent = 'Videoyu durdur'; } else { video.pause(); btn.textContent = 'Videoyu oynat'; }
      });
      $('.hero-sticky', hero).append(btn);
      video.addEventListener('ended', () => { btn.textContent = 'Videoyu oynat'; });
      video.play().catch(() => { btn.textContent = 'Videoyu oynat'; });
      return;
    }

    let duration = 9;
    let target = 0;
    let current = 0;
    let raf = 0;
    let primed = false;

    video.addEventListener('loadedmetadata', () => { duration = video.duration || 9; schedule(); });

    // Scrubbing needs a seekable source. The live server (behind Cloudflare)
    // answers Range requests with a full 200, which makes <video> unseekable,
    // so the file is downloaded once and played from a Blob URL instead.
    (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(String(res.status));
        video.addEventListener('error', () => { if (video.src.startsWith('blob:')) video.src = src; }, { once: true });
        video.src = URL.createObjectURL(await res.blob());
      } catch (_) {
        video.src = src;
      }
    })();

    // iOS Safari only paints seeks after the media element has been started once.
    function prime() {
      if (primed) return;
      primed = true;
      const p = video.play();
      if (p && p.then) p.then(() => { video.pause(); seek(current); }).catch(() => {});
    }
    ['touchstart', 'pointerdown', 'wheel', 'keydown'].forEach((t) => window.addEventListener(t, prime, { once: true, passive: true }));

    function progress() {
      const total = hero.offsetHeight - window.innerHeight;
      return total > 0 ? clamp(-hero.getBoundingClientRect().top / total) : 0;
    }
    function seek(p) {
      if (video.readyState < 1) return;
      const t = p * Math.max(0, duration - 0.05);
      if (!video.seeking && Math.abs(video.currentTime - t) > 0.01) video.currentTime = t;
    }
    function paint(p) {
      beats.forEach((b) => {
        const on = p >= Number(b.dataset.from) && p < Number(b.dataset.to);
        b.classList.toggle('is-on', on);
      });
      if (fill) fill.style.strokeDashoffset = String(1 - p);
      hero.classList.toggle('is-scrolled', p > 0.02);
      hero.classList.toggle('is-done', p > 0.995);
    }
    function tick() {
      current += (target - current) * 0.18;
      if (Math.abs(target - current) < 0.0008) current = target;
      seek(current);
      paint(current);
      raf = current !== target ? requestAnimationFrame(tick) : 0;
    }
    function schedule() {
      target = progress();
      if (!raf) raf = requestAnimationFrame(tick);
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
  })();

  // The hero has its own booking buttons; keep the floating one out of the way there.
  if (hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => document.body.classList.toggle('in-hero', e.isIntersecting && e.intersectionRatio > 0.6),
      { threshold: [0, 0.6, 1] }).observe($('.hero-copy', hero));
  }

  /* ---------- Process steps ---------- */
  (function steps() {
    const items = $$('.step');
    const pics = $$('[data-step-img]');
    if (!items.length || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const n = e.target.dataset.step;
        items.forEach((i) => i.classList.toggle('is-on', i === e.target));
        pics.forEach((p) => p.classList.toggle('is-on', p.dataset.stepImg === n));
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    items.forEach((i) => io.observe(i));
    items[0].classList.add('is-on');
  })();

  /* ---------- Booking form ---------- */
  (function booking() {
    const form = $('#bookingForm');
    if (!form) return;
    const dateInput = $('#fDate');
    const slotsBox = $('#slots');
    const slotsHelp = $('#slotsHelp');
    const errorBox = $('#formError');
    const submitBtn = $('#submitBtn');
    const done = $('#bookingDone');
    const state = { segment: SEGMENTS[0], pkg: PACKAGES[0], date: '', time: '', peron: '', live: true, slots: [] };

    const today = new Date();
    state.date = isoDate(today);
    dateInput.min = state.date;
    const max = new Date(); max.setDate(max.getDate() + 60);
    dateInput.max = isoDate(max);
    dateInput.value = state.date;

    function total() { return price(state.pkg.base, state.segment.mult); }

    function renderPrices() {
      $$('#packageChoices input').forEach((inp) => {
        const p = PACKAGES.find((x) => x.name === inp.value);
        $('[data-price]', inp.closest('label')).textContent = tl(price(p.base, state.segment.mult));
      });
    }

    function renderSummary() {
      $('#sumSegment').textContent = state.segment.label;
      $('#sumPackage').textContent = state.pkg.label;
      $('#sumDate').textContent = state.date ? dayLabel(state.date) : '—';
      $('#sumTime').textContent = state.time ? `${state.time}${state.peron ? `, ${state.peron}` : ''}` : '—';
      $('#sumDuration').textContent = minutesLabel(state.pkg.min);
      $('#sumTotal').textContent = tl(total());
    }

    function selectSlot(s) {
      state.time = s.time;
      state.peron = s.peron;
      $$('.slot', slotsBox).forEach((b) => {
        const on = b.dataset.time === s.time;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      renderSummary();
    }

    function renderSlots() {
      slotsBox.textContent = '';
      const open = state.slots.filter((s) => s.free > 0 && !s.past);
      if (!open.some((s) => s.time === state.time)) { state.time = open[0] ? open[0].time : ''; state.peron = open[0] ? open[0].peron : ''; }
      if (!state.slots.length || !open.length) {
        slotsBox.append(el('p', { class: 'slots-empty', text: 'Bu gün için boş saat kalmadı. Başka bir gün seçin ya da WhatsApp’tan yazın.' }));
      }
      state.slots.forEach((s) => {
        const disabled = s.free <= 0 || s.past;
        const note = s.past ? 'geçti' : s.free <= 0 ? 'dolu' : s.free === 1 ? 'son peron' : 'boş';
        const b = el('button', {
          type: 'button', class: 'slot', role: 'radio', 'data-time': s.time,
          'aria-checked': String(s.time === state.time && !disabled), tabindex: s.time === state.time ? '0' : '-1', disabled
        }, el('b', { text: s.time }), el('small', { text: note }));
        b.addEventListener('click', () => selectSlot(s));
        slotsBox.append(b);
      });
      slotsHelp.textContent = state.live
        ? 'İki peronumuz var. Dolu saatler seçilemez.'
        : 'Saat bilgisi şu an alınamadı. Talebiniz WhatsApp’tan gönderilir, uygunluğu biz teyit ederiz.';
      submitBtn.textContent = state.live ? 'Randevuyu kaydet' : 'WhatsApp’tan talep gönder';
      renderSummary();
    }

    // arrow keys move within the slot radiogroup
    slotsBox.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const btns = $$('.slot:not(:disabled)', slotsBox);
      const i = btns.findIndex((b) => b.dataset.time === state.time);
      const next = btns[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length];
      if (next) { e.preventDefault(); next.click(); next.focus(); }
    });

    async function refreshSlots() {
      slotsBox.setAttribute('aria-busy', 'true');
      const r = await loadSlots(state.date);
      state.live = r.live;
      state.slots = r.slots;
      slotsBox.removeAttribute('aria-busy');
      renderSlots();
    }

    $$('#segmentChoices input').forEach((inp) => inp.addEventListener('change', () => {
      state.segment = SEGMENTS.find((s) => s.name === inp.value) || SEGMENTS[0];
      renderPrices(); renderSummary();
    }));
    $$('#packageChoices input').forEach((inp) => inp.addEventListener('change', () => {
      state.pkg = PACKAGES.find((p) => p.name === inp.value) || PACKAGES[0];
      renderSummary();
    }));
    dateInput.addEventListener('change', () => {
      if (!dateInput.value) return;
      state.date = dateInput.value < dateInput.min ? dateInput.min : dateInput.value;
      dateInput.value = state.date;
      refreshSlots();
    });
    $('#fPlate').addEventListener('blur', (e) => { if (e.target.value) e.target.value = normalizePlate(e.target.value); });

    function fail(msg, field) {
      errorBox.textContent = msg;
      errorBox.hidden = false;
      $$('[aria-invalid]', form).forEach((f) => f.removeAttribute('aria-invalid'));
      if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
    }

    function showDone(b, appt) {
      const text = whatsappText({ ...b, code: appt.code, peron: appt.peron || b.peron });
      done.textContent = '';
      const stamps = typeof appt.loyaltyStamps === 'number' ? appt.loyaltyStamps : null;
      done.append(
        el('h3', { text: appt.code ? 'Randevunuz kaydedildi' : 'Talebiniz hazır' }),
        el('p', {},
          appt.code ? 'Kodunuz ' : '',
          appt.code ? el('span', { class: 'code', text: appt.code }) : '',
          appt.code ? `. ${dayLabel(b.date)}, saat ${b.time}${appt.peron ? `, ${appt.peron}` : ''}. Özeti WhatsApp’tan gönderirseniz hemen teyit ederiz.`
            : 'Aşağıdaki butonla WhatsApp’tan gönderin; saati teyit edip size dönüyoruz.'),
        appt.isFifthFree ? el('p', { text: 'Bu sizin beşinci yıkamanız; iç-dış yıkama ücretsiz.' })
          : stamps != null ? el('p', { text: `Kartınızda ${stamps} damga var.` }) : null,
        el('a', { class: 'btn btn-wa btn-block', href: waLink(text), target: '_blank', rel: 'noopener', text: 'WhatsApp’tan gönder' })
      );
      done.hidden = false;
      done.focus();
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const plate = $('#fPlate'); const name = $('#fName'); const phone = $('#fPhone'); const consent = $('#fConsent');
      if (!state.time) return fail('Lütfen boş bir saat seçin.', slotsBox.querySelector('.slot:not(:disabled)'));
      if (!validPlate(plate.value)) return fail('Plakayı 34 ABC 123 biçiminde yazın.', plate);
      if (name.value.trim().length < 3) return fail('Adınızı ve soyadınızı yazın.', name);
      const ph = normalizePhone(phone.value);
      if (!ph) return fail('Cep telefonunu 05xx xxx xx xx biçiminde yazın.', phone);
      if (!consent.checked) return fail('Devam etmek için aydınlatma metnini okuduğunuzu işaretleyin.', consent);

      const b = {
        segment: state.segment.name, segmentLabel: state.segment.label,
        package: state.pkg.name, packageLabel: state.pkg.label,
        total: total(), minutes: state.pkg.min, date: state.date, time: state.time, peron: state.peron,
        plate: normalizePlate(plate.value), name: name.value.trim(), phone: ph, note: $('#fNote').value.trim()
      };

      if (!state.live) { showDone(b, {}); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Kaydediliyor…';
      try {
        const appt = await createAppointment(b);
        showDone(b, appt);
        form.reset();
        $('#segmentChoices input').checked = true; $('#packageChoices input').checked = true;
        state.segment = SEGMENTS[0]; state.pkg = PACKAGES[0];
        dateInput.value = state.date;
        renderPrices();
        await refreshSlots();
      } catch (err) {
        if (err.status && err.status < 500 && err.data && err.data.error) {
          fail(`${err.data.error} Başka bir saat seçebilir ya da WhatsApp’tan yazabilirsiniz.`);
          refreshSlots();
        } else {
          // server down: don't lose the customer, hand over to WhatsApp
          showDone(b, {});
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = state.live ? 'Randevuyu kaydet' : 'WhatsApp’tan talep gönder';
      }
    });

    renderPrices();
    renderSummary();
    // Late in the day there may be nothing left today: open on tomorrow instead.
    refreshSlots().then(() => {
      if (state.slots.some((s) => s.free > 0 && !s.past)) return;
      const t = new Date(); t.setDate(t.getDate() + 1);
      state.date = isoDate(t);
      dateInput.value = state.date;
      refreshSlots();
    });
    window.MarineBooking = { refreshSlots };
  })();

  /* ---------- Lookup (no cancel button: cancellations go through WhatsApp) ---------- */
  (function lookup() {
    const form = $('#lookupForm');
    const out = $('#lookupResult');
    if (!form) return;
    const statusText = (s) => String(s || '').toLocaleLowerCase('tr-TR');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = $('#lookupInput').value.trim();
      if (q.length < 4) { out.textContent = 'Plaka ya da randevu kodunu yazın.'; return; }
      out.textContent = 'Sorgulanıyor…';
      try {
        const data = await api(`api/lookup?q=${encodeURIComponent(q)}`);
        out.textContent = '';
        const n = clamp(Number(data.loyaltyStamps) || 0, 0, 5);
        out.append(el('p', { text: `Kartınızda ${n} damga var${n >= 4 ? '; sıradaki iç-dış yıkama bizden.' : '.'}` }));
        const st = el('div', { class: 'stamps', 'aria-hidden': 'true' });
        for (let i = 0; i < 5; i += 1) st.append(el('span', { class: i < n ? 'on' : '' }));
        out.append(st);
        const list = Array.isArray(data.appointments) ? data.appointments : [];
        if (!list.length) { out.append(el('p', { text: 'Kayıtlı bir randevu görünmüyor.' })); return; }
        list.forEach((a) => out.append(el('div', { class: 'lookup-item' },
          el('b', { text: a.code || '' }), ' · ',
          `${a.date ? dayLabel(a.date) : ''}, ${a.time || ''}`,
          el('br'),
          `${PACKAGES.find((p) => p.name === a.packageName)?.label || a.packageName || ''} — ${statusText(a.status) || 'kayıtlı'}`
        )));
      } catch (_) {
        out.textContent = 'Şu an sorgulanamıyor. 0545 949 90 99 numarasından bize ulaşabilirsiniz.';
      }
    });
  })();

  /* ---------- Quick booking assistant (scripted) ---------- */
  (function assistant() {
    const panel = $('#assist');
    const bar = $('#assistBar');
    const log = $('#assistLog');
    const chips = $('#assistChips');
    const form = $('#assistForm');
    const input = $('#assistInput');
    if (!panel) return;

    let step = 0;
    let b = {};
    let slots = [];
    let live = true;
    let timer = 0;

    const say = (text, who = 'bot') => {
      log.append(el('div', { class: `msg msg-${who}`, text }));
      log.scrollTop = log.scrollHeight;
    };
    const setChips = (list) => {
      chips.textContent = '';
      list.forEach((c) => chips.append(el('button', { type: 'button', class: 'chip', text: c.label, onclick: () => answer(c.label, c) })));
    };
    const ask = (text, list = [], placeholder = 'Yazın ya da seçin') => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        say(text);
        setChips(list);
        input.placeholder = placeholder;
      }, reduceMotion ? 0 : 280);
    };

    function faq(text) {
      const t = text.toLocaleLowerCase('tr-TR');
      if (/fiyat|ücret|kaç|ne kadar/.test(t)) return 'Binekte iç-dış yıkama 450 ₺, detaylı yıkama ve sıvı seramik 850 ₺, detaylı iç temizlik 3.500 ₺. SUV ve van için fiyatlar biraz daha yüksek; ödeme tesiste.';
      if (/wi-?fi|kahve|kafe|sipariş|bekle/.test(t)) return 'Beklerken sipariş zorunlu değil, Wi-Fi ücretsiz. Kafede kahve, kruvasan ve tost var.';
      if (/nerede|adres|konum|yol/.test(t)) return 'Avcılar Denizköşkler, sahil yolu üzerindeyiz. Her gün 09.00–22.00 açığız.';
      return null;
    }

    function prompt() {
      if (step === 0) ask('Merhaba. Aracınızın tipi ne?', SEGMENTS.map((s) => ({ label: s.label, seg: s })));
      else if (step === 1) ask('Hangi paket?', PACKAGES.map((p) => ({ label: `${p.label} · ${tl(price(p.base, b.seg.mult))}`, pkg: p })));
      else if (step === 2) {
        const days = [0, 1, 2, 3].map((i) => { const d = new Date(); d.setDate(d.getDate() + i); return isoDate(d); });
        ask('Hangi gün gelmek istersiniz?', days.map((iso, i) => ({ label: i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : dayLabel(iso), date: iso })));
      } else if (step === 3) {
        const open = slots.filter((s) => s.free > 0 && !s.past);
        if (!open.length) { step = 2; say('O gün boş saat kalmadı, başka bir gün seçelim.'); prompt(); return; }
        ask(`${dayLabel(b.date)} için boş saatler:${live ? '' : ' (uygunluğu WhatsApp’tan teyit edeceğiz)'}`, open.map((s) => ({ label: s.time, slot: s })), 'Saat yazın, örn. 14:00');
      } else if (step === 4) ask('Plakanız?', [], '34 ABC 123');
      else if (step === 5) ask('Adınız ve soyadınız?', [], 'Ad soyad');
      else if (step === 6) ask('Cep telefonunuz?', [], '05xx xxx xx xx');
      else if (step === 7) {
        ask(`Özet: ${b.seg.label}, ${b.pkg.label}, ${dayLabel(b.date)} ${b.time}, ${tl(price(b.pkg.base, b.seg.mult))}. Bilgileriniz yalnızca randevu için kullanılır (aydınlatma metni: sayfanın altında). Onaylıyor musunuz?`,
          [{ label: 'Onaylıyorum, kaydet', confirm: true }, { label: 'Baştan başla', restart: true }]);
      }
    }

    async function finish() {
      chips.textContent = '';
      const data = {
        segment: b.seg.name, segmentLabel: b.seg.label, package: b.pkg.name, packageLabel: b.pkg.label,
        total: price(b.pkg.base, b.seg.mult), minutes: b.pkg.min, date: b.date, time: b.time, peron: b.peron,
        plate: b.plate, name: b.name, phone: b.phone, note: '', source: 'asistan'
      };
      let appt = {};
      if (live) {
        try { appt = await createAppointment(data); } catch (err) {
          if (err.data && err.data.error) { say(`${err.data.error} Başka bir saat seçelim.`); step = 3; slots = (await loadSlots(b.date)).slots; prompt(); return; }
        }
        if (window.MarineBooking) window.MarineBooking.refreshSlots();
      }
      const text = whatsappText({ ...data, code: appt.code, peron: appt.peron || b.peron });
      const card = el('div', { class: 'msg msg-card' },
        appt.code ? `Kaydedildi. Kodunuz ${appt.code}. Özeti WhatsApp’tan gönderirseniz hemen teyit ederiz.` : 'Talebiniz hazır. WhatsApp’tan gönderin, saati teyit edip dönelim.',
        el('a', { class: 'btn btn-wa', href: waLink(text), target: '_blank', rel: 'noopener', text: 'WhatsApp’tan gönder' }));
      log.append(card);
      log.scrollTop = log.scrollHeight;
      step = 8;
      setChips([{ label: 'Yeni randevu', restart: true }]);
    }

    async function answer(text, meta = {}) {
      if (!text.trim()) return;
      say(text, 'user');
      chips.textContent = '';
      if (meta.restart) { restart(); return; }
      const f = !Object.keys(meta).length && step < 4 ? faq(text) : null;
      if (f) { say(f); prompt(); return; }
      const t = text.toLocaleLowerCase('tr-TR');

      if (step === 0) {
        b.seg = meta.seg || (/suv|cross|jeep/.test(t) ? SEGMENTS[1] : /pick|van|kamyonet|minibüs/.test(t) ? SEGMENTS[2] : SEGMENTS[0]);
        step = 1;
      } else if (step === 1) {
        b.pkg = meta.pkg || (/seramik|detaylı yıkama|cila/.test(t) ? PACKAGES[1] : /iç temizlik|koltuk|buhar|ozon/.test(t) ? PACKAGES[2] : PACKAGES[0]);
        step = 2;
      } else if (step === 2) {
        const d = new Date();
        if (meta.date) b.date = meta.date;
        else if (/yarın/.test(t)) { d.setDate(d.getDate() + 1); b.date = isoDate(d); } else b.date = isoDate(d);
        const r = await loadSlots(b.date);
        slots = r.slots; live = r.live;
        step = 3;
      } else if (step === 3) {
        const m = meta.slot ? meta.slot.time : (t.match(/\b([01]?\d|2[0-3])[:.]?([0-5]\d)\b/) || []).slice(1).join(':');
        const s = slots.find((x) => x.time === (m && m.padStart(5, '0')) && x.free > 0 && !x.past);
        if (!s) { say('Bu saat boş değil. Listeden birini seçer misiniz?'); prompt(); return; }
        b.time = s.time; b.peron = s.peron;
        step = 4;
      } else if (step === 4) {
        if (!validPlate(text)) { say('Plakayı 34 ABC 123 biçiminde yazar mısınız?'); return; }
        b.plate = normalizePlate(text); step = 5;
      } else if (step === 5) {
        if (text.trim().length < 3) { say('Ad ve soyadınızı yazar mısınız?'); return; }
        b.name = text.trim(); step = 6;
      } else if (step === 6) {
        const ph = normalizePhone(text);
        if (!ph) { say('Numarayı 05xx xxx xx xx biçiminde yazar mısınız?'); return; }
        b.phone = ph; step = 7;
      } else if (step === 7) {
        if (meta.confirm || /evet|onay|tamam/.test(t)) { finish(); return; }
        restart(); return;
      } else { restart(); return; }
      prompt();
    }

    function restart() {
      clearTimeout(timer);
      log.textContent = '';
      chips.textContent = '';
      step = 0; b = {}; slots = []; live = true;
      prompt();
    }

    function open() {
      panel.hidden = false;
      bar.setAttribute('aria-expanded', 'true');
      if (!log.childElementCount) restart();
      setTimeout(() => input.focus({ preventScroll: true }), 50);
    }
    function close() {
      panel.hidden = true;
      bar.setAttribute('aria-expanded', 'false');
      bar.focus();
    }
    bar.addEventListener('click', open);
    // the booking form is already on screen there; the button would only cover it
    const bookingSection = $('#randevu');
    if (bookingSection && 'IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => bar.classList.toggle('is-away', e.isIntersecting), { rootMargin: '-20% 0px -20% 0px' }).observe(bookingSection);
    }
    $('#assistClose').addEventListener('click', close);
    $('#assistRestart').addEventListener('click', restart);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      answer(v);
    });
  })();
})();
