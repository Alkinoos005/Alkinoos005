/* ============================================================
   Chess — full rewrite: standard rules engine + i18n + themes
   ============================================================ */

/* ==========================================================================
   Chess engine — pure logic, no DOM/jQuery dependency.
   Board coordinates: file 1..8 (a..h), rank 1..8 (1 = White's back rank).
   ========================================================================== */

(function (root) {
  'use strict';

  var KNIGHT_OFFSETS = [
    [1, 2], [2, 1], [-1, 2], [-2, 1],
    [1, -2], [2, -1], [-1, -2], [-2, -1]
  ];
  var KING_OFFSETS = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1]
  ];
  var DIAG_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var ORTH_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  var TYPE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

  function key(f, r) { return f + '_' + r; }
  function inBounds(f, r) { return f >= 1 && f <= 8 && r >= 1 && r <= 8; }

  function backRankType(f) {
    if (f === 1 || f === 8) return 'r';
    if (f === 2 || f === 7) return 'n';
    if (f === 3 || f === 6) return 'b';
    if (f === 4) return 'q';
    return 'k'; // f === 5
  }

  function createInitialBoard() {
    var board = {};
    for (var f = 1; f <= 8; f++) {
      for (var r = 1; r <= 8; r++) {
        board[key(f, r)] = null;
      }
    }
    for (var f2 = 1; f2 <= 8; f2++) {
      board[key(f2, 8)] = { color: 'b', type: backRankType(f2), moved: false };
      board[key(f2, 7)] = { color: 'b', type: 'p', moved: false };
      board[key(f2, 2)] = { color: 'w', type: 'p', moved: false };
      board[key(f2, 1)] = { color: 'w', type: backRankType(f2), moved: false };
    }
    return board;
  }

  function createInitialState() {
    return {
      board: createInitialBoard(),
      turn: 'w',
      castleRights: { w: { K: true, Q: true }, b: { K: true, Q: true } },
      enPassantTarget: null,
      status: 'playing',   // 'playing' | 'checkmate' | 'stalemate'
      winner: null,        // 'w' | 'b' | null
      inCheck: false
    };
  }

  function cloneBoard(board) {
    var copy = {};
    for (var k in board) {
      copy[k] = board[k] ? { color: board[k].color, type: board[k].type, moved: board[k].moved } : null;
    }
    return copy;
  }

  function findKing(color, board) {
    for (var f = 1; f <= 8; f++) {
      for (var r = 1; r <= 8; r++) {
        var p = board[key(f, r)];
        if (p && p.color === color && p.type === 'k') return { f: f, r: r };
      }
    }
    return null;
  }

  function isSquareAttacked(f, r, byColor, board) {
    // pawns
    var d = byColor === 'w' ? 1 : -1;
    for (var i = 0; i < 2; i++) {
      var df = i === 0 ? -1 : 1;
      var pf = f + df, pr = r - d;
      if (inBounds(pf, pr)) {
        var pp = board[key(pf, pr)];
        if (pp && pp.color === byColor && pp.type === 'p') return true;
      }
    }
    // knights
    for (var kn = 0; kn < KNIGHT_OFFSETS.length; kn++) {
      var nf = f + KNIGHT_OFFSETS[kn][0], nr = r + KNIGHT_OFFSETS[kn][1];
      if (inBounds(nf, nr)) {
        var np = board[key(nf, nr)];
        if (np && np.color === byColor && np.type === 'n') return true;
      }
    }
    // king
    for (var kg = 0; kg < KING_OFFSETS.length; kg++) {
      var kf = f + KING_OFFSETS[kg][0], kr = r + KING_OFFSETS[kg][1];
      if (inBounds(kf, kr)) {
        var kp = board[key(kf, kr)];
        if (kp && kp.color === byColor && kp.type === 'k') return true;
      }
    }
    // diagonal sliders (bishop/queen)
    for (var dg = 0; dg < DIAG_DIRS.length; dg++) {
      var dfx = DIAG_DIRS[dg][0], dry = DIAG_DIRS[dg][1];
      var sf = f + dfx, sr = r + dry;
      while (inBounds(sf, sr)) {
        var sp = board[key(sf, sr)];
        if (sp) {
          if (sp.color === byColor && (sp.type === 'b' || sp.type === 'q')) return true;
          break;
        }
        sf += dfx; sr += dry;
      }
    }
    // orthogonal sliders (rook/queen)
    for (var og = 0; og < ORTH_DIRS.length; og++) {
      var ofx = ORTH_DIRS[og][0], ory = ORTH_DIRS[og][1];
      var tf = f + ofx, tr = r + ory;
      while (inBounds(tf, tr)) {
        var tp = board[key(tf, tr)];
        if (tp) {
          if (tp.color === byColor && (tp.type === 'r' || tp.type === 'q')) return true;
          break;
        }
        tf += ofx; tr += ory;
      }
    }
    return false;
  }

  function isInCheck(color, board) {
    var kingPos = findKing(color, board);
    if (!kingPos) return false;
    var opp = color === 'w' ? 'b' : 'w';
    return isSquareAttacked(kingPos.f, kingPos.r, opp, board);
  }

  function slidingMoves(f, r, color, board, dirs) {
    var moves = [];
    for (var i = 0; i < dirs.length; i++) {
      var df = dirs[i][0], dr = dirs[i][1];
      var nf = f + df, nr = r + dr;
      while (inBounds(nf, nr)) {
        var occ = board[key(nf, nr)];
        if (!occ) {
          moves.push({ from: { f: f, r: r }, to: { f: nf, r: nr } });
        } else {
          if (occ.color !== color) {
            moves.push({ from: { f: f, r: r }, to: { f: nf, r: nr }, capture: true, capturedAt: { f: nf, r: nr } });
          }
          break;
        }
        nf += df; nr += dr;
      }
    }
    return moves;
  }

  function stepMoves(f, r, color, board, offsets) {
    var moves = [];
    for (var i = 0; i < offsets.length; i++) {
      var nf = f + offsets[i][0], nr = r + offsets[i][1];
      if (!inBounds(nf, nr)) continue;
      var occ = board[key(nf, nr)];
      if (!occ) {
        moves.push({ from: { f: f, r: r }, to: { f: nf, r: nr } });
      } else if (occ.color !== color) {
        moves.push({ from: { f: f, r: r }, to: { f: nf, r: nr }, capture: true, capturedAt: { f: nf, r: nr } });
      }
    }
    return moves;
  }

  function pawnMoves(f, r, color, state) {
    var board = state.board;
    var d = color === 'w' ? 1 : -1;
    var startRank = color === 'w' ? 2 : 7;
    var promRank = color === 'w' ? 8 : 1;
    var moves = [];

    var f1 = f, r1 = r + d;
    if (inBounds(f1, r1) && !board[key(f1, r1)]) {
      moves.push({ from: { f: f, r: r }, to: { f: f1, r: r1 }, special: (r1 === promRank ? 'promotion' : null) });
      if (r === startRank) {
        var r2 = r + 2 * d;
        if (!board[key(f1, r2)]) {
          moves.push({ from: { f: f, r: r }, to: { f: f1, r: r2 }, special: 'doublePush' });
        }
      }
    }

    for (var i = 0; i < 2; i++) {
      var df = i === 0 ? -1 : 1;
      var cf = f + df, cr = r + d;
      if (!inBounds(cf, cr)) continue;
      var occ = board[key(cf, cr)];
      if (occ && occ.color !== color) {
        moves.push({
          from: { f: f, r: r }, to: { f: cf, r: cr },
          capture: true, capturedAt: { f: cf, r: cr },
          special: (cr === promRank ? 'promotion' : null)
        });
      } else if (!occ && state.enPassantTarget && state.enPassantTarget.f === cf && state.enPassantTarget.r === cr) {
        moves.push({
          from: { f: f, r: r }, to: { f: cf, r: cr },
          capture: true, capturedAt: { f: cf, r: r },
          special: 'enPassant'
        });
      }
    }

    return moves;
  }

  function castleMoves(color, state) {
    var board = state.board;
    var rank = color === 'w' ? 1 : 8;
    var opp = color === 'w' ? 'b' : 'w';
    var rights = state.castleRights[color];
    var moves = [];

    if (rights.K) {
      var f6 = board[key(6, rank)], f7 = board[key(7, rank)];
      var rook = board[key(8, rank)];
      if (!f6 && !f7 && rook && rook.type === 'r' && rook.color === color) {
        if (!isSquareAttacked(5, rank, opp, board) &&
            !isSquareAttacked(6, rank, opp, board) &&
            !isSquareAttacked(7, rank, opp, board)) {
          moves.push({ from: { f: 5, r: rank }, to: { f: 7, r: rank }, special: 'castleK' });
        }
      }
    }
    if (rights.Q) {
      var f4 = board[key(4, rank)], f3 = board[key(3, rank)], f2 = board[key(2, rank)];
      var rookQ = board[key(1, rank)];
      if (!f4 && !f3 && !f2 && rookQ && rookQ.type === 'r' && rookQ.color === color) {
        if (!isSquareAttacked(5, rank, opp, board) &&
            !isSquareAttacked(4, rank, opp, board) &&
            !isSquareAttacked(3, rank, opp, board)) {
          moves.push({ from: { f: 5, r: rank }, to: { f: 3, r: rank }, special: 'castleQ' });
        }
      }
    }
    return moves;
  }

  function pseudoMovesForSquare(f, r, state) {
    var board = state.board;
    var piece = board[key(f, r)];
    if (!piece) return [];
    var color = piece.color;
    switch (piece.type) {
      case 'p': return pawnMoves(f, r, color, state);
      case 'n': return stepMoves(f, r, color, board, KNIGHT_OFFSETS);
      case 'b': return slidingMoves(f, r, color, board, DIAG_DIRS);
      case 'r': return slidingMoves(f, r, color, board, ORTH_DIRS);
      case 'q': return slidingMoves(f, r, color, board, DIAG_DIRS.concat(ORTH_DIRS));
      case 'k': return stepMoves(f, r, color, board, KING_OFFSETS).concat(castleMoves(color, state));
      default: return [];
    }
  }

  // Applies a move to a board object IN PLACE. Returns the captured piece (or null).
  function applyMoveToBoard(board, mv, promotionType) {
    var piece = board[key(mv.from.f, mv.from.r)];
    var captured = null;

    if (mv.capturedAt) {
      captured = board[key(mv.capturedAt.f, mv.capturedAt.r)];
      board[key(mv.capturedAt.f, mv.capturedAt.r)] = null;
    }

    if (mv.special === 'castleK') {
      var rankK = mv.from.r;
      var rookK = board[key(8, rankK)];
      board[key(8, rankK)] = null;
      board[key(6, rankK)] = rookK ? { color: rookK.color, type: rookK.type, moved: true } : null;
    } else if (mv.special === 'castleQ') {
      var rankQ = mv.from.r;
      var rookQ = board[key(1, rankQ)];
      board[key(1, rankQ)] = null;
      board[key(4, rankQ)] = rookQ ? { color: rookQ.color, type: rookQ.type, moved: true } : null;
    }

    board[key(mv.from.f, mv.from.r)] = null;
    var movedPiece = { color: piece.color, type: piece.type, moved: true };
    if (mv.special === 'promotion') {
      movedPiece.type = promotionType || 'q';
    }
    board[key(mv.to.f, mv.to.r)] = movedPiece;

    return captured;
  }

  function generateLegalMoves(f, r, state) {
    var piece = state.board[key(f, r)];
    if (!piece || piece.color !== state.turn) return [];
    var pseudo = pseudoMovesForSquare(f, r, state);
    var legal = [];
    for (var i = 0; i < pseudo.length; i++) {
      var mv = pseudo[i];
      var testBoard = cloneBoard(state.board);
      applyMoveToBoard(testBoard, mv, 'q');
      if (!isInCheck(piece.color, testBoard)) {
        legal.push(mv);
      }
    }
    return legal;
  }

  function generateAllLegalMoves(color, state) {
    var all = [];
    for (var f = 1; f <= 8; f++) {
      for (var r = 1; r <= 8; r++) {
        var piece = state.board[key(f, r)];
        if (piece && piece.color === color) {
          all = all.concat(generateLegalMoves(f, r, state));
        }
      }
    }
    return all;
  }

  // Commits a legal move to the live game state: updates board, castling
  // rights, en-passant target, turn, and derived status (check/mate/stalemate).
  // promotionType defaults to 'q' (auto-queen).
  function commitMove(state, mv, promotionType) {
    var mover = state.board[key(mv.from.f, mv.from.r)];
    var moverColor = mover.color;

    var captured = applyMoveToBoard(state.board, mv, promotionType || 'q');

    // castling rights bookkeeping
    if (mover.type === 'k') {
      state.castleRights[moverColor].K = false;
      state.castleRights[moverColor].Q = false;
    }
    if (mover.type === 'r') {
      var rank = moverColor === 'w' ? 1 : 8;
      if (mv.from.f === 8 && mv.from.r === rank) state.castleRights[moverColor].K = false;
      if (mv.from.f === 1 && mv.from.r === rank) state.castleRights[moverColor].Q = false;
    }
    if (captured && captured.type === 'r') {
      var oppColor = moverColor === 'w' ? 'b' : 'w';
      var oppRank = oppColor === 'w' ? 1 : 8;
      if (mv.capturedAt.f === 8 && mv.capturedAt.r === oppRank) state.castleRights[oppColor].K = false;
      if (mv.capturedAt.f === 1 && mv.capturedAt.r === oppRank) state.castleRights[oppColor].Q = false;
    }

    // en passant target
    if (mv.special === 'doublePush') {
      state.enPassantTarget = { f: mv.from.f, r: (mv.from.r + mv.to.r) / 2 };
    } else {
      state.enPassantTarget = null;
    }

    // switch turn
    state.turn = moverColor === 'w' ? 'b' : 'w';

    // derive status for the side now to move
    var inCheck = isInCheck(state.turn, state.board);
    var legalMoves = generateAllLegalMoves(state.turn, state);
    state.inCheck = inCheck;
    if (legalMoves.length === 0) {
      state.status = inCheck ? 'checkmate' : 'stalemate';
      state.winner = inCheck ? moverColor : null;
    } else {
      state.status = 'playing';
      state.winner = null;
    }

    return {
      mover: mover,
      moverColor: moverColor,
      captured: captured,
      promoted: mv.special === 'promotion',
      special: mv.special || null
    };
  }

  var ChessEngine = {
    key: key,
    inBounds: inBounds,
    TYPE_NAME: TYPE_NAME,
    createInitialBoard: createInitialBoard,
    createInitialState: createInitialState,
    cloneBoard: cloneBoard,
    findKing: findKing,
    isSquareAttacked: isSquareAttacked,
    isInCheck: isInCheck,
    generateLegalMoves: generateLegalMoves,
    generateAllLegalMoves: generateAllLegalMoves,
    applyMoveToBoard: applyMoveToBoard,
    commitMove: commitMove
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChessEngine;
  } else {
    root.ChessEngine = ChessEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);

/* ==========================================================================
   Translations — en, el, es, fr, it, de, zh
   ========================================================================== */

var TRANSLATIONS = {
  en: {
    langName: 'English',
    title: 'Chess',
    newGame: 'New Game',
    hint: 'Tap a piece to see where it can move.',
    turn_w: "White's turn",
    turn_b: "Black's turn",
    check_w: 'White is in check!',
    check_b: 'Black is in check!',
    checkmate_w: 'Checkmate — Black wins!',
    checkmate_b: 'Checkmate — White wins!',
    stalemate: 'Stalemate — draw!',
    lostQueen_w: 'White lost their queen!',
    lostQueen_b: 'Black lost their queen!',
    promoted: 'Pawn promoted to queen!',
    themeToLight: 'Switch to light mode',
    themeToDark: 'Switch to dark mode',
    langLabel: 'Language'
  },
  el: {
    langName: 'Ελληνικά',
    title: 'Σκάκι',
    newGame: 'Νέο Παιχνίδι',
    hint: 'Πάτησε ένα κομμάτι για να δεις πού μπορεί να παίξει.',
    turn_w: 'Παίζουν τα Λευκά',
    turn_b: 'Παίζουν τα Μαύρα',
    check_w: 'Τα Λευκά είναι σε σαχ!',
    check_b: 'Τα Μαύρα είναι σε σαχ!',
    checkmate_w: 'Ματ — Νικούν τα Μαύρα!',
    checkmate_b: 'Ματ — Νικούν τα Λευκά!',
    stalemate: 'Πατ — Ισοπαλία!',
    lostQueen_w: 'Τα Λευκά έχασαν τη βασίλισσά τους!',
    lostQueen_b: 'Τα Μαύρα έχασαν τη βασίλισσά τους!',
    promoted: 'Το πιόνι έγινε βασίλισσα!',
    themeToLight: 'Εναλλαγή σε φωτεινή λειτουργία',
    themeToDark: 'Εναλλαγή σε σκοτεινή λειτουργία',
    langLabel: 'Γλώσσα'
  },
  es: {
    langName: 'Español',
    title: 'Ajedrez',
    newGame: 'Nueva Partida',
    hint: 'Toca una pieza para ver sus movimientos.',
    turn_w: 'Juegan las Blancas',
    turn_b: 'Juegan las Negras',
    check_w: '¡Las Blancas están en jaque!',
    check_b: '¡Las Negras están en jaque!',
    checkmate_w: 'Jaque mate — ¡Ganan las Negras!',
    checkmate_b: 'Jaque mate — ¡Ganan las Blancas!',
    stalemate: '¡Tablas por ahogado!',
    lostQueen_w: '¡Las Blancas perdieron su reina!',
    lostQueen_b: '¡Las Negras perdieron su reina!',
    promoted: '¡Peón coronado a reina!',
    themeToLight: 'Cambiar a modo claro',
    themeToDark: 'Cambiar a modo oscuro',
    langLabel: 'Idioma'
  },
  fr: {
    langName: 'Français',
    title: 'Échecs',
    newGame: 'Nouvelle Partie',
    hint: 'Touchez une pièce pour voir ses déplacements.',
    turn_w: 'Aux Blancs de jouer',
    turn_b: 'Aux Noirs de jouer',
    check_w: 'Les Blancs sont en échec !',
    check_b: 'Les Noirs sont en échec !',
    checkmate_w: 'Échec et mat — les Noirs gagnent !',
    checkmate_b: 'Échec et mat — les Blancs gagnent !',
    stalemate: 'Pat — match nul !',
    lostQueen_w: 'Les Blancs ont perdu leur dame !',
    lostQueen_b: 'Les Noirs ont perdu leur dame !',
    promoted: 'Pion promu en dame !',
    themeToLight: 'Passer en mode clair',
    themeToDark: 'Passer en mode sombre',
    langLabel: 'Langue'
  },
  it: {
    langName: 'Italiano',
    title: 'Scacchi',
    newGame: 'Nuova Partita',
    hint: 'Tocca un pezzo per vedere le sue mosse.',
    turn_w: 'Tocca al Bianco',
    turn_b: 'Tocca al Nero',
    check_w: 'Il Bianco è sotto scacco!',
    check_b: 'Il Nero è sotto scacco!',
    checkmate_w: 'Scacco matto — vince il Nero!',
    checkmate_b: 'Scacco matto — vince il Bianco!',
    stalemate: 'Stallo — pareggio!',
    lostQueen_w: 'Il Bianco ha perso la regina!',
    lostQueen_b: 'Il Nero ha perso la regina!',
    promoted: 'Pedone promosso a regina!',
    themeToLight: 'Passa alla modalità chiara',
    themeToDark: 'Passa alla modalità scura',
    langLabel: 'Lingua'
  },
  de: {
    langName: 'Deutsch',
    title: 'Schach',
    newGame: 'Neues Spiel',
    hint: 'Tippe auf eine Figur, um ihre Züge zu sehen.',
    turn_w: 'Weiß ist am Zug',
    turn_b: 'Schwarz ist am Zug',
    check_w: 'Weiß steht im Schach!',
    check_b: 'Schwarz steht im Schach!',
    checkmate_w: 'Schachmatt — Schwarz gewinnt!',
    checkmate_b: 'Schachmatt — Weiß gewinnt!',
    stalemate: 'Patt — Unentschieden!',
    lostQueen_w: 'Weiß hat die Dame verloren!',
    lostQueen_b: 'Schwarz hat die Dame verloren!',
    promoted: 'Bauer zur Dame befördert!',
    themeToLight: 'Zum hellen Modus wechseln',
    themeToDark: 'Zum dunklen Modus wechseln',
    langLabel: 'Sprache'
  },
  zh: {
    langName: '中文',
    title: '国际象棋',
    newGame: '新对局',
    hint: '点击棋子查看可走的位置。',
    turn_w: '白方走棋',
    turn_b: '黑方走棋',
    check_w: '白方被将军！',
    check_b: '黑方被将军！',
    checkmate_w: '将死 — 黑方获胜！',
    checkmate_b: '将死 — 白方获胜！',
    stalemate: '逼和 — 平局！',
    lostQueen_w: '白方失去了后！',
    lostQueen_b: '黑方失去了后！',
    promoted: '兵升变为后！',
    themeToLight: '切换到浅色模式',
    themeToDark: '切换到深色模式',
    langLabel: '语言'
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TRANSLATIONS;
}

/* ==========================================================================
   UI layer — binds the ChessEngine to the DOM. Depends on jQuery,
   ChessEngine (engine.js) and TRANSLATIONS (translations.js).
   ========================================================================== */

if (typeof $ !== 'undefined' && typeof ChessEngine !== 'undefined') {
  (function () {
    'use strict';

    var GLYPHS = {
      w_king: '\u2654', w_queen: '\u2655', w_rook: '\u2656',
      w_bishop: '\u2657', w_knight: '\u2658', w_pawn: '\u2659',
      b_king: '\u265A', b_queen: '\u265B', b_rook: '\u265C',
      b_bishop: '\u265D', b_knight: '\u265E', b_pawn: '\u265F'
    };

    var SUPPORTED_LANGS = ['en', 'el', 'es', 'fr', 'it', 'de', 'zh'];

    var app = {
      state: ChessEngine.createInitialState(),
      selected: null,          // "f_r" string
      legalByTarget: {},       // "f_r" -> move
      lang: 'en',
      theme: 'light'
    };

    function t(key) {
      var dict = TRANSLATIONS[app.lang] || TRANSLATIONS.en;
      return dict[key] !== undefined ? dict[key] : TRANSLATIONS.en[key];
    }

    function detectInitialLang() {
      try {
        var saved = localStorage.getItem('chess.lang');
        if (saved && SUPPORTED_LANGS.indexOf(saved) !== -1) return saved;
      } catch (e) { /* ignore */ }
      var nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
      return SUPPORTED_LANGS.indexOf(nav) !== -1 ? nav : 'en';
    }

    function detectInitialTheme() {
      try {
        var saved = localStorage.getItem('chess.theme');
        if (saved === 'light' || saved === 'dark') return saved;
      } catch (e) { /* ignore */ }
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
      return 'light';
    }

    function applyTheme() {
      document.documentElement.setAttribute('data-theme', app.theme);
      var btn = document.getElementById('themeToggle');
      if (btn) {
        btn.textContent = app.theme === 'dark' ? '\u2600\uFE0F' : '\u{1F319}';
        btn.setAttribute('aria-label', app.theme === 'dark' ? t('themeToLight') : t('themeToDark'));
        btn.setAttribute('title', app.theme === 'dark' ? t('themeToLight') : t('themeToDark'));
      }
    }

    function applyLanguageStrings() {
      document.documentElement.setAttribute('lang', app.lang);
      $('#titleText').text(t('title'));
      $('#newGameBtn').text(t('newGame'));
      $('#hintText').text(t('hint'));
      var langSelect = document.getElementById('langSelect');
      if (langSelect) langSelect.setAttribute('aria-label', t('langLabel'));
      applyTheme(); // refreshes theme button aria-label/title in the new language
      updateStatusUI();
    }

    function showToast(message) {
      var toast = $('#toast');
      toast.text(message);
      toast.addClass('toast-visible');
      clearTimeout(app._toastTimer);
      app._toastTimer = setTimeout(function () {
        toast.removeClass('toast-visible');
      }, 2600);
    }

    function render() {
      for (var f = 1; f <= 8; f++) {
        for (var r = 1; r <= 8; r++) {
          var id = f + '_' + r;
          var el = document.getElementById(id);
          if (!el) continue;
          el.classList.remove('green', 'in-check', 'selected');
          var piece = app.state.board[id];
          if (piece) {
            var name = piece.color + '_' + ChessEngine.TYPE_NAME[piece.type];
            el.setAttribute('chess', name);
            el.textContent = GLYPHS[name] || '';
          } else {
            el.setAttribute('chess', 'null');
            el.textContent = '';
          }
        }
      }
      if (app.state.inCheck) {
        var kingPos = ChessEngine.findKing(app.state.turn, app.state.board);
        if (kingPos) {
          var kingEl = document.getElementById(kingPos.f + '_' + kingPos.r);
          if (kingEl) kingEl.classList.add('in-check');
        }
      }
      if (app.selected) {
        var selEl = document.getElementById(app.selected);
        if (selEl) selEl.classList.add('selected');
        for (var targetId in app.legalByTarget) {
          var tEl = document.getElementById(targetId);
          if (tEl) tEl.classList.add('green');
        }
      }
    }

    function updateStatusUI() {
      var text;
      var gameOver = false;
      if (app.state.status === 'checkmate') {
        text = app.state.winner === 'w' ? t('checkmate_b') : t('checkmate_w');
        gameOver = true;
      } else if (app.state.status === 'stalemate') {
        text = t('stalemate');
        gameOver = true;
      } else if (app.state.inCheck) {
        text = app.state.turn === 'w' ? t('check_w') : t('check_b');
      } else {
        text = app.state.turn === 'w' ? t('turn_w') : t('turn_b');
      }
      $('#turn').text(text);
      $('#turn').toggleClass('turnhighlight', gameOver);
    }

    function clearSelection() {
      app.selected = null;
      app.legalByTarget = {};
    }

    function selectSquare(id) {
      var parts = id.split('_');
      var f = parseInt(parts[0], 10), r = parseInt(parts[1], 10);
      var legal = ChessEngine.generateLegalMoves(f, r, app.state);
      if (legal.length === 0) { clearSelection(); render(); return; }
      app.selected = id;
      app.legalByTarget = {};
      for (var i = 0; i < legal.length; i++) {
        app.legalByTarget[legal[i].to.f + '_' + legal[i].to.r] = legal[i];
      }
      render();
    }

    function onCellClick(id) {
      if (app.state.status !== 'playing') return;

      var piece = app.state.board[id];
      var ownPiece = piece && piece.color === app.state.turn;

      if (!app.selected) {
        if (ownPiece) selectSquare(id);
        return;
      }

      if (id === app.selected) {
        clearSelection();
        render();
        return;
      }

      if (app.legalByTarget[id]) {
        var mv = app.legalByTarget[id];
        var result = ChessEngine.commitMove(app.state, mv, 'q');
        clearSelection();
        render();
        updateStatusUI();

        var msgs = [];
        if (result.promoted) msgs.push(t('promoted'));
        if (result.captured && result.captured.type === 'q') {
          msgs.push(result.captured.color === 'w' ? t('lostQueen_w') : t('lostQueen_b'));
        }
        if (msgs.length) showToast(msgs.join(' '));
        return;
      }

      if (ownPiece) {
        selectSquare(id);
        return;
      }

      clearSelection();
      render();
    }

    function newGame() {
      app.state = ChessEngine.createInitialState();
      clearSelection();
      render();
      updateStatusUI();
    }

    function init() {
      app.lang = detectInitialLang();
      app.theme = detectInitialTheme();

      var langSelect = document.getElementById('langSelect');
      if (langSelect) {
        langSelect.innerHTML = '';
        for (var i = 0; i < SUPPORTED_LANGS.length; i++) {
          var code = SUPPORTED_LANGS[i];
          var opt = document.createElement('option');
          opt.value = code;
          opt.textContent = TRANSLATIONS[code].langName;
          if (code === app.lang) opt.selected = true;
          langSelect.appendChild(opt);
        }
        langSelect.addEventListener('change', function (e) {
          app.lang = e.target.value;
          try { localStorage.setItem('chess.lang', app.lang); } catch (err) { /* ignore */ }
          applyLanguageStrings();
        });
      }

      var themeBtn = document.getElementById('themeToggle');
      if (themeBtn) {
        themeBtn.addEventListener('click', function () {
          app.theme = app.theme === 'dark' ? 'light' : 'dark';
          try { localStorage.setItem('chess.theme', app.theme); } catch (err) { /* ignore */ }
          applyTheme();
        });
      }

      var newGameBtn = document.getElementById('newGameBtn');
      if (newGameBtn) {
        newGameBtn.addEventListener('click', newGame);
      }

      $('#game').on('click', '.gamecell', function () {
        onCellClick(this.id);
      });

      applyTheme();
      applyLanguageStrings();
      render();
      updateStatusUI();
    }

    $(init);
  })();
}
