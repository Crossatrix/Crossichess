// ===== Ledger Chess — Spiel-Logik, Bot & Bewertungssystem =====

const game = new Chess();

const PIECE_UNICODE = {
  wp:"♙", wn:"♘", wb:"♗", wr:"♖", wq:"♕", wk:"♔",
  bp:"♟", bn:"♞", bb:"♝", br:"♜", bq:"♛", bk:"♚"
};

const FILES = ["a","b","c","d","e","f","g","h"];

let state = {
  mode: "bot",        // 'bot' | 'local' | 'rated'
  selected: null,
  legalTargets: [],
  lastMove: null,
  botDepth: 2,
  botSide: "b",
  thinking: false,
  ratings: []          // { color, san, classification }
};

const boardEl = document.getElementById("board");
const statusText = document.getElementById("statusText");
const turnIndicator = document.getElementById("turnIndicator");
const moveLedgerEl = document.getElementById("moveLedger");
const capturedWhiteEl = document.getElementById("capturedWhite");
const capturedBlackEl = document.getElementById("capturedBlack");
const ratingSummaryEl = document.getElementById("ratingSummary");
const coordsBottomEl = document.getElementById("coordsBottom");

FILES.forEach(f => {
  const s = document.createElement("span");
  s.textContent = f;
  coordsBottomEl.appendChild(s);
});

document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.mode = btn.dataset.mode;
    document.getElementById("botOptions").style.display = state.mode === "bot" ? "block" : "none";
    document.getElementById("ratedInfo").style.display = state.mode === "rated" ? "block" : "none";
    resetGame();
  });
});

document.getElementById("difficulty").addEventListener("change", e => {
  state.botDepth = parseInt(e.target.value, 10);
});
document.getElementById("botSide").addEventListener("change", e => {
  state.botSide = e.target.value;
  resetGame();
});
document.getElementById("resetBtn").addEventListener("click", resetGame);

function resetGame(){
  game.reset();
  state.selected = null;
  state.legalTargets = [];
  state.lastMove = null;
  state.thinking = false;
  state.ratings = [];
  renderAll();
  maybeBotMove();
}

function squareColor(file, rank){
  const idx = FILES.indexOf(file);
  return (idx + rank) % 2 === 0 ? "dark" : "light";
}

function renderBoard(){
  boardEl.innerHTML = "";
  for (let rank = 8; rank >= 1; rank--){
    for (let f = 0; f < 8; f++){
      const file = FILES[f];
      const square = file + rank;
      const div = document.createElement("div");
      div.className = "sq " + squareColor(file, rank);
      div.dataset.square = square;

      if (state.selected === square) div.classList.add("selected");
      if (state.lastMove && (state.lastMove.from === square || state.lastMove.to === square)) {
        div.classList.add("lastmove");
      }
      if (state.legalTargets.some(m => m.to === square)){
        div.classList.add("legal");
        if (game.get(square)) div.classList.add("capture");
      }

      const piece = game.get(square);
      if (piece){
        const span = document.createElement("span");
        span.className = "piece " + (piece.color === "w" ? "white" : "black");
        span.textContent = PIECE_UNICODE[piece.color + piece.type];
        div.appendChild(span);
      }

      div.addEventListener("click", () => onSquareClick(square));
      boardEl.appendChild(div);
    }
  }
}

function onSquareClick(square){
  if (state.thinking) return;
  if (isBotTurnLocked()) return;

  const piece = game.get(square);

  if (state.selected){
    const move = state.legalTargets.find(m => m.to === square);
    if (move){
      makeMove(state.selected, square);
      state.selected = null;
      state.legalTargets = [];
      renderAll();
      maybeBotMove();
      return;
    }
    // reselect
    if (piece && piece.color === game.turn()){
      state.selected = square;
      state.legalTargets = game.moves({ square, verbose:true });
    } else {
      state.selected = null;
      state.legalTargets = [];
    }
    renderBoard();
    return;
  }

  if (piece && piece.color === game.turn()){
    state.selected = square;
    state.legalTargets = game.moves({ square, verbose:true });
    renderBoard();
  }
}

function isBotTurnLocked(){
  return state.mode === "bot" && game.turn() === state.botSide;
}

function makeMove(from, to, promotion){
  const preFen = game.fen();
  const mover = game.turn();

  let ratingInfo = null;
  if (state.mode === "rated"){
    ratingInfo = evaluateMoveQuality(preFen, from, to, promotion);
  }

  const moveObj = game.move({ from, to, promotion: promotion || "q" });
  if (!moveObj) return null;

  state.lastMove = { from, to };

  if (state.mode === "rated" && ratingInfo){
    state.ratings.push({
      color: mover,
      san: moveObj.san,
      classification: ratingInfo.classification
    });
  } else {
    state.ratings.push({ color: mover, san: moveObj.san, classification: null });
  }

  return moveObj;
}

function maybeBotMove(){
  if (state.mode !== "bot") return;
  if (game.game_over()) return;
  if (game.turn() !== state.botSide) return;

  state.thinking = true;
  statusText.textContent = "Bot denkt nach...";
  statusText.classList.add("thinking");

  setTimeout(() => {
    const best = findBestMove(game, state.botDepth);
    if (best){
      makeMove(best.from, best.to, best.promotion);
    }
    state.thinking = false;
    statusText.classList.remove("thinking");
    renderAll();
  }, 60);
}

// ===== Bewertung der Stellung (Material + Positions-Tabellen) =====

const VALUES = { p:100, n:320, b:330, r:500, q:900, k:0 };

const PST_PAWN = [
  0,0,0,0,0,0,0,0,
  50,50,50,50,50,50,50,50,
  10,10,20,30,30,20,10,10,
  5,5,10,25,25,10,5,5,
  0,0,0,20,20,0,0,0,
  5,-5,-10,0,0,-10,-5,5,
  5,10,10,-20,-20,10,10,5,
  0,0,0,0,0,0,0,0
];
const PST_KNIGHT = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,0,0,0,0,-20,-40,
  -30,0,10,15,15,10,0,-30,
  -30,5,15,20,20,15,5,-30,
  -30,0,15,20,20,15,0,-30,
  -30,5,10,15,15,10,5,-30,
  -40,-20,0,5,5,0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50
];
const PST_BISHOP = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,0,0,0,0,0,0,-10,
  -10,0,5,10,10,5,0,-10,
  -10,5,5,10,10,5,5,-10,
  -10,0,10,10,10,10,0,-10,
  -10,10,10,10,10,10,10,-10,
  -10,5,0,0,0,0,5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20
];
const PST_ROOK = [
  0,0,0,0,0,0,0,0,
  5,10,10,10,10,10,10,5,
  -5,0,0,0,0,0,0,-5,
  -5,0,0,0,0,0,0,-5,
  -5,0,0,0,0,0,0,-5,
  -5,0,0,0,0,0,0,-5,
  -5,0,0,0,0,0,0,-5,
  0,0,0,5,5,0,0,0
];
const PST_QUEEN = [
  -20,-10,-10,-5,-5,-10,-10,-20,
  -10,0,0,0,0,0,0,-10,
  -10,0,5,5,5,5,0,-10,
  -5,0,5,5,5,5,0,-5,
  0,0,5,5,5,5,0,-5,
  -10,5,5,5,5,5,0,-10,
  -10,0,5,0,0,0,0,-10,
  -20,-10,-10,-5,-5,-10,-10,-20
];
const PST_KING = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
  20,20,0,0,0,0,20,20,
  20,30,10,0,0,10,30,20
];
const PST = { p:PST_PAWN, n:PST_KNIGHT, b:PST_BISHOP, r:PST_ROOK, q:PST_QUEEN, k:PST_KING };

function squareIndex(square){
  const file = FILES.indexOf(square[0]);
  const rank = parseInt(square[1], 10);
  return { file, rank };
}

function pstValue(piece, square){
  const { file, rank } = squareIndex(square);
  // table is defined rank8->rank1 (index0 = rank8)
  const row = piece.color === "w" ? (8 - rank) : (rank - 1);
  const idx = row * 8 + file;
  const table = PST[piece.type];
  let val = table[idx];
  if (piece.color === "b") val = table[(7 - row) * 8 + file];
  return val;
}

function evaluateBoard(g){
  let score = 0;
  const board = g.board();
  for (let r = 0; r < 8; r++){
    for (let f = 0; f < 8; f++){
      const piece = board[r][f];
      if (!piece) continue;
      const file = f;
      const rank = 8 - r;
      const square = FILES[file] + rank;
      const base = VALUES[piece.type];
      const pos = pstValue(piece, square);
      const sign = piece.color === "w" ? 1 : -1;
      score += sign * (base + pos);
    }
  }
  if (g.in_checkmate()){
    score += g.turn() === "w" ? -100000 : 100000;
  }
  return score;
}

// Negamax mit Alpha-Beta-Suche. Rückgabe: Score aus Sicht von Weiß (positiv = gut für Weiß).
function negamax(g, depth, alpha, beta, colorSign){
  if (depth === 0 || g.game_over()){
    return colorSign * evaluateBoard(g);
  }
  const moves = g.moves({ verbose:true });
  if (moves.length === 0){
    return colorSign * evaluateBoard(g);
  }
  let best = -Infinity;
  for (const m of moves){
    g.move(m);
    const score = -negamax(g, depth - 1, -beta, -alpha, -colorSign);
    g.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function findBestMove(g, depth){
  const moves = g.moves({ verbose:true });
  if (moves.length === 0) return null;
  const colorSign = g.turn() === "w" ? 1 : -1;
  let bestMove = null;
  let bestScore = -Infinity;
  let alpha = -Infinity, beta = Infinity;

  // leichte Zufallsstreuung, damit der Bot nicht immer identisch spielt
  const shuffled = moves.slice().sort(() => Math.random() - 0.5);

  for (const m of shuffled){
    g.move(m);
    const score = -negamax(g, depth - 1, -beta, -alpha, -colorSign);
    g.undo();
    if (score > bestScore){
      bestScore = score;
      bestMove = m;
    }
    if (bestScore > alpha) alpha = bestScore;
  }
  return bestMove ? { from: bestMove.from, to: bestMove.to, promotion: bestMove.promotion, score: bestScore } : null;
}

// ===== Zugbewertung (Chess.com-artige Klassifikation) =====

function getAllMoveScores(g, depth){
  // Gibt für jeden legalen Zug den resultierenden negamax-Score zurück,
  // aus Sicht des ziehenden Spielers (positiv = gut für ihn).
  const moves = g.moves({ verbose:true });
  const colorSign = g.turn() === "w" ? 1 : -1;
  const results = [];
  for (const m of moves){
    g.move(m);
    const score = -negamax(g, depth - 1, -Infinity, Infinity, -colorSign);
    g.undo();
    results.push({ move: m, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

function pieceHangs(g, square, movingColor){
  // grobe Erkennung: steht die Figur nach dem Zug im Zugriff einer
  // gegnerischen Figur mit geringerem oder gleichem Wert?
  const piece = g.get(square);
  if (!piece) return false;
  const enemyColor = movingColor === "w" ? "b" : "w";
  const fen = g.fen();
  const parts = fen.split(" ");
  parts[1] = enemyColor;
  parts[3] = "-";
  let testFen;
  try {
    testFen = parts.join(" ");
  } catch(e){ return false; }
  const test = new Chess();
  if (!test.load(testFen)) return false;
  const attackerMoves = test.moves({ verbose:true }).filter(m => m.to === square);
  if (attackerMoves.length === 0) return false;
  const minAttackerValue = Math.min(...attackerMoves.map(m => VALUES[m.piece]));
  return minAttackerValue <= VALUES[piece.type];
}

function evaluateMoveQuality(preFen, from, to, promotion){
  const depth = Math.max(2, state.botDepth);
  const analyzer = new Chess();
  analyzer.load(preFen);
  const mover = analyzer.turn();

  const scored = getAllMoveScores(analyzer, depth);
  if (scored.length === 0) return { classification: "best" };

  const bestScore = scored[0].score;
  const secondScore = scored.length > 1 ? scored[1].score : bestScore;

  const chosen = scored.find(s => s.move.from === from && s.move.to === to &&
    (!promotion || s.move.promotion === promotion));
  const chosenScore = chosen ? chosen.score : -Infinity;

  const loss = bestScore - chosenScore; // in centipawns, >=0

  let classification;
  const isBestMove = chosen && chosen === scored[0];

  if (isBestMove){
    // Brilliant-Heuristik: bester Zug opfert scheinbar Material, bleibt aber
    // die klar beste Fortsetzung.
    analyzer.move({ from, to, promotion: promotion || "q" });
    const sacrifices = pieceHangs(analyzer, to, mover) && VALUES[analyzer.get(to)?.type] >= VALUES.n;
    analyzer.undo();

    const margin = bestScore - secondScore;
    if (sacrifices && bestScore > -50){
      classification = "brilliant";
    } else if (margin >= 150 && scored.length > 2){
      classification = "great";
    } else {
      classification = "best";
    }
  } else if (loss <= 15){
    classification = "excellent";
  } else if (loss <= 40){
    classification = "good";
  } else if (loss <= 90){
    classification = "inaccuracy";
  } else if (loss <= 200){
    classification = "mistake";
  } else {
    classification = "blunder";
  }

  return { classification };
}

const CLASS_LABELS = {
  brilliant: "Brilliant",
  great: "Genial",
  best: "Bester Zug",
  excellent: "Exzellent",
  good: "Gut",
  inaccuracy: "Ungenau",
  mistake: "Fehler",
  blunder: "Patzer"
};

// ===== Promotion-Handling (einfach: immer Dame) =====
// (Für dieses Projekt wird bei Bauernumwandlung automatisch zur Dame promoviert.)

// ===== Rendering =====

function renderStatus(){
  let text = "";
  if (game.in_checkmate()){
    text = (game.turn() === "w" ? "Schwarz" : "Weiß") + " gewinnt durch Matt!";
  } else if (game.in_stalemate()){
    text = "Patt – Remis.";
  } else if (game.in_draw()){
    text = "Remis.";
  } else if (game.in_check()){
    text = (game.turn() === "w" ? "Weiß" : "Schwarz") + " steht im Schach.";
  } else {
    text = (game.turn() === "w" ? "Weiß" : "Schwarz") + " am Zug.";
  }
  statusText.textContent = text;
  turnIndicator.textContent = game.turn() === "w" ? "Weiß am Zug" : "Schwarz am Zug";
}

function renderCaptured(){
  const history = game.history({ verbose:true });
  const capturedByWhite = [];
  const capturedByBlack = [];
  history.forEach(m => {
    if (m.captured){
      const symbol = PIECE_UNICODE[(m.color === "w" ? "b" : "w") + m.captured];
      if (m.color === "w") capturedByWhite.push(symbol);
      else capturedByBlack.push(symbol);
    }
  });
  capturedWhiteEl.textContent = capturedByWhite.join(" ");
  capturedBlackEl.textContent = capturedByBlack.join(" ");
}

function renderLedger(){
  moveLedgerEl.innerHTML = "";
  const history = game.history();
  for (let i = 0; i < history.length; i += 2){
    const pairEl = document.createElement("div");
    pairEl.className = "mv-pair";
    const num = document.createElement("span");
    num.className = "mv-num";
    num.textContent = (i / 2 + 1) + ".";
    pairEl.appendChild(num);

    [0, 1].forEach(offset => {
      const idx = i + offset;
      if (idx >= history.length) return;
      const san = document.createElement("span");
      san.className = "mv-san";
      san.textContent = history[idx];
      const rating = state.ratings[idx];
      if (rating && rating.classification){
        const badge = document.createElement("span");
        badge.className = "badge " + rating.classification;
        badge.textContent = CLASS_LABELS[rating.classification];
        san.appendChild(badge);
      }
      pairEl.appendChild(san);
    });
    moveLedgerEl.appendChild(pairEl);
  }
  moveLedgerEl.scrollTop = moveLedgerEl.scrollHeight;
}

function renderRatingSummary(){
  if (state.mode !== "rated") return;
  const counts = {};
  state.ratings.forEach(r => {
    if (!r.classification) return;
    counts[r.classification] = (counts[r.classification] || 0) + 1;
  });
  ratingSummaryEl.innerHTML = "";
  Object.keys(CLASS_LABELS).forEach(key => {
    if (!counts[key]) return;
    const row = document.createElement("div");
    row.innerHTML = `${CLASS_LABELS[key]}: <span class="num">${counts[key]}</span>`;
    ratingSummaryEl.appendChild(row);
  });
}

function renderAll(){
  renderBoard();
  renderStatus();
  renderCaptured();
  renderLedger();
  renderRatingSummary();
}

// Umwandlung: chess.js verlangt promotion bei Bauern auf letzter Reihe.
// makeMove() übergibt standardmäßig 'q' — das deckt den Normalfall ab.

renderAll();
maybeBotMove();
