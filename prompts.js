// Prompts y validación de entradas de Nemy.
// Se usan en la Edge Function `nemy` (servidor) y se incrustan tal cual en el modo demo del frontend.
// Solo texto y funciones puras. Al incrustarlo en el HTML se eliminan los "export ".

export function clip(v, n) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
}
function list(a, n) { return Array.isArray(a) ? a.slice(0, n) : []; }
function int(v, min, max, d) {
  var n = parseInt(v, 10);
  if (isNaN(n)) return d;
  return Math.max(min, Math.min(max, n));
}
function cleanProfile(p) {
  p = p && typeof p === 'object' ? p : {};
  return { level: clip(p.level, 20), time: clip(p.time, 30), aim: clip(p.aim, 140) };
}
function cleanLog(a) {
  return list(a, 15).map(function (l) {
    l = l || {};
    return { goal: clip(l.goal, 100), note: clip(l.note, 300), feedback: clip(l.feedback, 200) };
  });
}
function cleanMaster(m) {
  m = m && typeof m === 'object' ? m : {};
  return {
    title: clip(m.title, 90), promise: clip(m.promise, 240), why: clip(m.why, 260),
    modules: list(m.modules, 5).map(function (x) { x = x || {}; return { t: clip(x.t, 80), d: clip(x.d, 170) }; })
  };
}
function cleanMessages(a) {
  var out = list(a, 12).map(function (m) {
    m = m || {};
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: clip(m.content, 600) };
  }).filter(function (m) { return m.content; });
  while (out.length && out[0].role !== 'user') out.shift();
  while (out.length && out[out.length - 1].role !== 'user') out.pop();
  return out;
}

export function sanitize(task, raw) {
  var r = raw && typeof raw === 'object' ? raw : {};
  var base = { topic: clip(r.topic, 80), name: clip(r.name, 40), levelLabel: clip(r.levelLabel, 70) };
  if (task === 'suggest') {
    return Object.assign(base, { history: list(r.history, 6).map(function (x) { return clip(x, 100); }) });
  }
  if (task === 'steps') return Object.assign(base, { goal: clip(r.goal, 100) });
  if (task === 'evaluate') {
    return Object.assign(base, {
      goal: clip(r.goal, 100), note: clip(r.note, 600),
      steps: list(r.steps, 3).map(function (s) { s = s || {}; return { t: clip(s.t, 120), done: !!s.done }; })
    });
  }
  if (task === 'design_master') {
    return Object.assign(base, { xp: int(r.xp, 0, 100000, 0), mprofile: cleanProfile(r.mprofile), log: cleanLog(r.log) });
  }
  if (task === 'lesson') {
    return Object.assign(base, {
      xp: int(r.xp, 0, 100000, 0), mprofile: cleanProfile(r.mprofile), log: cleanLog(r.log),
      master: cleanMaster(r.master), index: int(r.index, 0, 4, 0)
    });
  }
  if (task === 'chat') {
    return Object.assign(base, {
      goal: clip(r.goal, 100),
      steps: list(r.steps, 3).map(function (s) { s = s || {}; return { t: clip(s.t, 120), done: !!s.done }; }),
      tone: r.tone === 'directo' ? 'directo' : 'cercano',
      length: r.length === 'breve' || r.length === 'detallada' ? r.length : 'normal',
      messages: cleanMessages(r.messages)
    });
  }
  return base;
}

var BASE = 'Eres Nemy, mentora de una app de aprendizaje por niveles. Escribes en español, con claridad y rigor profesional, sin emojis. ' +
  'Si no sabes algo, lo dices. Nunca inventas datos, estadísticas, estudios ni fuentes.';

function ctx(i) {
  return 'Tema: ' + i.topic + '.' + (i.levelLabel ? ' ' + i.levelLabel + '.' : '') + (i.name ? ' La persona se llama ' + i.name + '.' : '');
}
function profileBlock(i) {
  var p = i.mprofile || {};
  var log = (i.log || []).map(function (l, n) {
    return (n + 1) + '. Objetivo: ' + l.goal + ' | Lo que contó: ' + l.note + ' | Evaluación de Nemy: ' + l.feedback;
  }).join('\n') || 'Sin registros.';
  return 'Tema: ' + i.topic + '.' + (i.name ? ' La persona se llama ' + i.name + '.' : '') +
    '\nNivel que se atribuye: ' + p.level + '. Tiempo disponible: ' + p.time + '.\nQué quiere conseguir: ' + p.aim +
    '.\nHistorial del recorrido (' + i.xp + ' XP):\n' + log;
}

// Devuelve { tier: 'fast'|'smart', json: bool, stream: bool, maxTokens, system, messages }.
export function build(task, i) {
  if (task === 'suggest') {
    return {
      tier: 'fast', json: true, stream: false, maxTokens: 200, system: BASE,
      messages: [{ role: 'user', content: ctx(i) + ' Propón un objetivo concreto, medible y que se pueda terminar en una sola sesión, adecuado a ese nivel de dificultad. ' +
        'No repitas estos: ' + ((i.history || []).join(' | ') || 'ninguno') + '. Responde solo con JSON: {"goal":"máximo 14 palabras"}' }]
    };
  }
  if (task === 'steps') {
    return {
      tier: 'fast', json: true, stream: false, maxTokens: 300, system: BASE,
      messages: [{ role: 'user', content: ctx(i) + ' Objetivo: ' + i.goal + '. Da tres pasos concretos y ordenados para lograrlo, cada uno de máximo 12 palabras. ' +
        'Responde solo con JSON: {"steps":["...","...","..."]}' }]
    };
  }
  if (task === 'evaluate') {
    var st = (i.steps || []).map(function (s) { return s.t + (s.done ? ' (hecho)' : ' (sin hacer)'); }).join('; ');
    return {
      tier: 'smart', json: true, stream: false, maxTokens: 700, system: BASE,
      messages: [{ role: 'user', content: ctx(i) + '\nObjetivo: ' + i.goal + '\nPasos y estado: ' + st + '\nLo que cuenta el usuario: ' + i.note +
        '\n\nEvalúa con honestidad. xp es un entero entre 30 y 100: más alto si el relato es concreto y muestra esfuerzo o resultado verificable, más bajo si es vago o los pasos están sin hacer. ' +
        'feedback: una o dos frases directas sobre qué salió bien y qué mejorar, sin adulación. lesson: una lección breve y correcta (2 o 3 frases) útil para el tema y para el siguiente nivel. ' +
        'Responde solo con JSON: {"xp":number,"feedback":"...","lesson":{"title":"...","body":"..."}}' }]
    };
  }
  if (task === 'design_master') {
    return {
      tier: 'smart', json: true, stream: false, maxTokens: 1200, system: BASE,
      messages: [{ role: 'user', content: profileBlock(i) +
        '\n\nDiseña una masterclass de pago personalizada para esta persona. Debe partir de lo que ya hizo y trabajar lo que le falta según las evaluaciones del historial. Nivel avanzado y práctica aplicada. ' +
        'No prometas resultados garantizados ni cifras de horas, ingresos o plazos. Responde solo con JSON: ' +
        '{"title":"máximo 8 palabras","promise":"una frase sobre lo que sabrá hacer al terminar","why":"una frase que explique cómo se adapta a esta persona, citando algo concreto de su historial",' +
        '"modules":[{"t":"título corto","d":"una frase"}]} con exactamente 5 módulos.' }]
    };
  }
  if (task === 'lesson') {
    var m = i.master, mod = m.modules[i.index] || { t: '', d: '' };
    return {
      tier: 'smart', json: false, stream: true, maxTokens: 1400,
      system: BASE + ' No uses formato markdown (sin asteriscos ni almohadillas). Separa los párrafos con una línea en blanco.',
      messages: [{ role: 'user', content: profileBlock(i) + '\n\nMasterclass: «' + m.title + '». Módulo ' + (i.index + 1) + ' de ' + m.modules.length + ': «' + mod.t + '» (' + mod.d + ').\n\n' +
        'Escribe la lección de este módulo para esta persona, de 350 a 450 palabras. Primero explica el concepto aplicándolo a lo que ya hizo y menciona algo concreto de su historial. ' +
        'Después da tres pasos concretos. Termina con un párrafo que empiece por «Ejercicio:» con una tarea de unos 20 minutos.' }]
    };
  }
  // chat
  var words = i.length === 'breve' ? 40 : i.length === 'detallada' ? 120 : 70;
  var tone = i.tone === 'directo' ? 'Sé directo y sin rodeos, sin frases de ánimo de relleno.' : 'Usa un tono cercano y amable.';
  var steps = (i.steps || []).map(function (s, n) { return (n + 1) + '. ' + s.t + (s.done ? ' (hecho)' : ' (pendiente)'); }).join('\n');
  return {
    tier: 'fast', json: false, stream: true, maxTokens: words * 4,
    system: BASE + ' ' + tone + ' Responde en un máximo de ' + words + ' palabras. Guía con preguntas y pistas concretas; no hagas el trabajo por el usuario.\n' +
      ctx(i) + '\nObjetivo actual: ' + i.goal + '\nPasos:\n' + steps,
    messages: i.messages
  };
}

// Lee el primer valor JSON de un texto (admite bloques ```json y texto alrededor). Devuelve null si no hay.
export function extractJson(text) {
  var t = String(text || '').trim();
  try { return JSON.parse(t); } catch (e) {}
  var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch (e) {} }
  var a = t.search(/[\[{]/);
  var b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  return null;
}
