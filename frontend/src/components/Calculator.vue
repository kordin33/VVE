<template>
  <div class="calculator glass-panel" :class="{ 'scientific-mode-active': isScientificMode }" @keydown="handleKeydown" tabindex="0" ref="calculatorRef">
     <!-- Integrated Close Button -->
     <button class="internal-close-btn" @click="$emit('close')">
       <X :size="20" />
     </button>

    <div class="display">
      <div class="expression">{{ currentExpression || '&nbsp;' }}</div>
      <div class="result">{{ result || '0' }}</div>
    </div>

    <!-- Combined Buttons Container -->
    <div class="buttons" :class="{ 'scientific-mode': isScientificMode }">
        <!-- Scientific Buttons Row 1: trig -->
        <button @click="inputFunction('sin(')" class="btn-sci sin">sin</button>
        <button @click="inputFunction('cos(')" class="btn-sci cos">cos</button>
        <button @click="inputFunction('tan(')" class="btn-sci tan">tan</button>
        <button @click="inputFunction('log10(')" class="btn-sci log">log</button>

        <!-- Scientific Buttons Row 2: inverse trig + ln -->
        <button @click="inputFunction('asin(')" class="btn-sci asin">sin⁻¹</button>
        <button @click="inputFunction('acos(')" class="btn-sci acos">cos⁻¹</button>
        <button @click="inputFunction('atan(')" class="btn-sci atan">tan⁻¹</button>
        <button @click="inputFunction('log(')" class="btn-sci ln">ln</button>

        <!-- Scientific Buttons Row 3: constants + ops -->
        <button @click="inputOperator('!')" class="btn-sci fact">n!</button>
        <button @click="inputConstant('pi')" class="btn-sci pi">π</button>
        <button @click="inputConstant('e')" class="btn-sci euler">e</button>
        <button @click="inputFunction('abs(')" class="btn-sci abs-fn">|x|</button>

        <!-- Scientific Buttons Row 4: parens + memory + power -->
        <button @click="inputFunction('sqrt(')" class="btn-sci sqrt">√</button>
        <button @click="inputOperator('^')" class="btn-sci pow">x^y</button>
        <button @click="inputParenthesis('(')" class="btn-sci paren-l">(</button>
        <button @click="inputParenthesis(')')" class="btn-sci paren-r">)</button>

        <!-- Scientific Buttons Row 5: memory -->
        <button @click="memoryStore" class="btn-sci mem-store" title="Memory Store">MS</button>
        <button @click="memoryRecall" class="btn-sci mem-recall" title="Memory Recall">MR</button>
        <button @click="memoryAdd" class="btn-sci mem-add" title="Memory Add">M+</button>
        <button @click="toggleScientificMode" class="btn-sci toggle-basic">Basic</button>

        <!-- Basic Buttons (Always Rendered, position adjusted by CSS) -->
        <button @click="clearAll" class="btn-op ac">AC</button>
        <button @click="inputOperator('/')" class="btn-op divide">÷</button>
        <button @click="inputOperator('*')" class="btn-op multiply">×</button>
        <button @click="backspace" class="btn-op backspace">
          <Delete :size="20" />
        </button>

        <button @click="inputDigit('7')" class="btn-digit seven">7</button>
        <button @click="inputDigit('8')" class="btn-digit eight">8</button>
        <button @click="inputDigit('9')" class="btn-digit nine">9</button>
        <button @click="inputOperator('-')" class="btn-op subtract">−</button>

        <button @click="inputDigit('4')" class="btn-digit four">4</button>
        <button @click="inputDigit('5')" class="btn-digit five">5</button>
        <button @click="inputDigit('6')" class="btn-digit six">6</button>
        <button @click="inputOperator('+')" class="btn-op add">+</button>

        <button @click="inputDigit('1')" class="btn-digit one">1</button>
        <button @click="inputDigit('2')" class="btn-digit two">2</button>
        <button @click="inputDigit('3')" class="btn-digit three">3</button>
        <button @click="calculate" class="btn-equal">=</button>

        <button @click="toggleScientificMode" class="btn-op sci-toggle">Sci</button>
        <button @click="inputDigit('0')" class="btn-digit btn-zero">0</button>
        <button @click="inputDecimal" class="btn-digit decimal">.</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { create, all } from 'mathjs';
import { copyToClipboard } from '../utils/fileUtils';
import { X, Copy, Delete } from 'lucide-vue-next';

// Configure mathjs
const math = create(all, {
  number: 'Fraction', // Use fractions for higher precision by default
  precision: 64 // Set precision for potential fallback or formatting
});

const currentExpression = ref('');
const result = ref('');
const statusMessage = ref(''); // 7.3: For clipboard feedback
const calculatorRef = ref(null);
const isScientificMode = ref(false);
const memory = ref(0);

const toggleScientificMode = () => {
  isScientificMode.value = !isScientificMode.value;
};

const inputDigit = (digit) => {
  currentExpression.value += digit;
};

const inputOperator = (op) => {
  // Add spaces around binary operators, handle unary factorial differently
  if (op === '!') {
     // Ensure space before factorial if previous char is not an operator/paren
     if (currentExpression.value && !/[\s(]$/.test(currentExpression.value)) {
         currentExpression.value += ' ';
     }
     currentExpression.value += op;
  } else if (currentExpression.value && !currentExpression.value.endsWith(' ')) {
    currentExpression.value += ' ' + op + ' ';
  } else {
     // Avoid adding space if expression is empty or already ends with space
     if (currentExpression.value) {
         currentExpression.value += op + ' ';
     } else {
         // Handle starting with a unary minus/plus if needed
         if (op === '-') {
             currentExpression.value += op;
         } else {
              currentExpression.value += op + ' ';
         }
     }
  }
};

const inputDecimal = () => {
  const segments = currentExpression.value.split(/[\s()]+/); // Split by space or parenthesis
  const lastSegment = segments[segments.length - 1];
  if (lastSegment && !lastSegment.includes('.')) {
    currentExpression.value += '.';
  } else if (!lastSegment && currentExpression.value.trim() === '') { // Handle starting with decimal
     currentExpression.value += '0.';
  } else if (currentExpression.value.endsWith(' ')) { // Handle decimal after operator
      currentExpression.value += '0.';
  }
};

const inputParenthesis = (paren) => {
   currentExpression.value += paren;
};

const inputFunction = (func) => {
  // Add function name with opening parenthesis
  currentExpression.value += func;
};

const inputConstant = (constant) => {
    // Add space if needed before constant
    if (currentExpression.value && !/[\s(]$/.test(currentExpression.value)) {
        currentExpression.value += ' ';
    }
    currentExpression.value += constant;
}

const clearAll = () => {
  currentExpression.value = '';
  result.value = '';
};

const clearEntry = () => {
  // More robust CE: remove last number or operator segment respecting spaces
  let expr = currentExpression.value.trimEnd();
  const lastChar = expr.slice(-1);
  if (lastChar === ' ') {
      // Remove operator and trailing space
      expr = expr.slice(0, -1).trimEnd();
      const lastSpaceIndex = expr.lastIndexOf(' ');
      if (lastSpaceIndex !== -1) {
          expr = expr.slice(0, lastSpaceIndex + 1);
      } else {
          expr = ''; // Removed the only operator
      }
  } else {
      // Remove last number segment
      const lastSpaceIndex = expr.lastIndexOf(' ');
       if (lastSpaceIndex !== -1) {
          expr = expr.slice(0, lastSpaceIndex + 1);
      } else {
          expr = ''; // Removed the only number
      }
  }
   currentExpression.value = expr;
};

// Function to handle Backspace button click
const backspace = () => {
  let expr = currentExpression.value;
  if (expr.endsWith(' ')) {
      // If the expression ends with a space (likely after an operator),
      // remove the operator and the spaces around it.
      currentExpression.value = expr.slice(0, -3);
  } else if (expr.length > 0) {
      // Otherwise, just remove the last character (digit, decimal, parenthesis, etc.)
      currentExpression.value = expr.slice(0, -1);
  }
};


const calculate = () => {
  if (!currentExpression.value) return;
  try {
    let expressionToProcess = currentExpression.value
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .trim();

    // Ensure balanced parentheses before simplifying/evaluating
    let openParen = (expressionToProcess.match(/\(/g) || []).length;
    let closeParen = (expressionToProcess.match(/\)/g) || []).length;
    while (openParen > closeParen) {
        expressionToProcess += ')';
        closeParen++;
    }

    // Attempt simplification first
    let simplifiedResult = null;
    try {
        simplifiedResult = math.simplify(expressionToProcess);
        // Check if simplification resulted in a simple number or fraction
        let evaluatedSimplifiedValue;
        let isSimple = false;
        try {
            // Temporarily configure mathjs to use standard numbers for this check
            const tempMath = create(all, { number: 'number' });
            evaluatedSimplifiedValue = tempMath.evaluate(simplifiedResult.toString());
            // Check if it's a finite number (not NaN or Infinity)
            isSimple = typeof evaluatedSimplifiedValue === 'number' && isFinite(evaluatedSimplifiedValue);
             // If the original was a fraction, consider it simple
            if (!isSimple && simplifiedResult.toString().includes('/')) {
                 try {
                     math.fraction(simplifiedResult.toString()); // Check if it parses as a fraction
                     isSimple = true;
                 } catch (fracError) { /* ignore */ }
            }

        } catch (e) {
             isSimple = false; // If evaluate fails, it's likely still symbolic
        }

        if (isSimple) {
             // If simple, format using Fraction config
             result.value = math.format(simplifiedResult, { fraction: 'ratio' });
             return;
        } else {
            // If simplification is complex (e.g., sqrt(3)), display its string form
            result.value = simplifiedResult.toString();
            return;
        }
    } catch (simplifyError) {
        console.warn("Simplification failed, falling back to fraction evaluation:", simplifyError);
        // Proceed to fraction evaluation if simplification fails
    }

    // Fallback: Evaluate using Fraction configuration
    const evalResult = math.evaluate(expressionToProcess); // math is already configured for Fractions
    result.value = math.format(evalResult, { fraction: 'ratio' }); // Format as fraction

  } catch (error) {
    console.error("Calculator error:", error);
    result.value = 'Error: ' + error.message; // Provide more error info
  }
};


// 7.3: Clipboard with fallback + toast feedback
const copyResult = () => {
  if (!result.value || result.value.startsWith('Error')) return;
  const text = result.value;
  const fallbackCopy = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch { return false; }
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => { statusMessage.value = 'Copied!'; setTimeout(() => statusMessage.value = '', 1500); })
      .catch(() => {
        if (fallbackCopy()) { statusMessage.value = 'Copied!'; setTimeout(() => statusMessage.value = '', 1500); }
        else { statusMessage.value = 'Copy failed'; setTimeout(() => statusMessage.value = '', 2000); }
      });
  } else {
    if (fallbackCopy()) { statusMessage.value = 'Copied!'; setTimeout(() => statusMessage.value = '', 1500); }
    else { statusMessage.value = 'Copy failed'; setTimeout(() => statusMessage.value = '', 2000); }
  }
};

const getNumericResult = () => {
  if (!result.value || result.value.startsWith('Error')) return 0;
  try {
    const tempMath = create(all, { number: 'number' });
    return tempMath.evaluate(result.value) || 0;
  } catch { return parseFloat(result.value) || 0; }
};

const memoryStore = () => { memory.value = getNumericResult(); };
const memoryRecall = () => {
  if (memory.value !== 0) {
    currentExpression.value += String(memory.value);
  }
};
const memoryAdd = () => { memory.value += getNumericResult(); };

// Keyboard support
const handleKeydown = (event) => {
  const key = event.key;

  if (/\d/.test(key)) {
    inputDigit(key);
  } else if (key === '.') {
    inputDecimal();
  } else if (['+', '-', '*', '/', '%', '^', '!'].includes(key)) { // Added '!'
    inputOperator(key);
  } else if (key === '(' || key === ')') {
    inputParenthesis(key);
  } else if (key === 'Enter' || key === '=') {
    event.preventDefault();
    calculate();
  } else if (key === 'Backspace') {
    // More robust backspace: remove last char or space+op+space
     let expr = currentExpression.value;
     if (expr.endsWith(' ')) {
         currentExpression.value = expr.slice(0, -3); // Remove space+op+space
     } else {
         currentExpression.value = expr.slice(0, -1); // Remove last char
     }
  } else if (key === 'Escape') {
    clearAll();
  }
};

onMounted(() => {
  nextTick(() => {
    calculatorRef.value?.focus();
  });
});

</script>

<style scoped>
.glass-panel {
  width: 320px; /* Fixed width */
  border-radius: 24px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 12px 35px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.5);
  font-family: 'Inter', sans-serif;
  display: flex;
  flex-direction: column;
  color: #1f2937;
  position: relative;
}

/* Internal Close Button Styling */
.internal-close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  color: #6b7280;
  cursor: pointer;
  padding: 4px;
  z-index: 10;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.internal-close-btn:hover {
  background: rgba(0,0,0,0.05);
  color: #374151;
}

.display {
  padding: 40px 24px 20px 24px;
  text-align: right;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  flex-shrink: 0;
  background: transparent;
}

.expression {
  font-size: 18px;
  color: #6b7280;
  min-height: 24px;
  word-break: break-all;
  overflow-wrap: break-word;
  margin-bottom: 8px;
}

.result {
  font-size: 48px;
  font-weight: 300;
  color: #111827;
  min-height: 60px;
  overflow-wrap: break-word;
  line-height: 1.1;
}

/* Combined Buttons Container */
.buttons {
  display: grid;
  gap: 10px;
  padding: 20px;
  flex-grow: 1;
  grid-template-columns: repeat(4, 1fr);
  background: rgba(255, 255, 255, 0.3);
}
/* Basic mode rows */
.buttons:not(.scientific-mode) {
  grid-template-rows: repeat(5, 1fr);
}
/* Scientific mode rows: 5 sci rows + 5 basic rows */
.buttons.scientific-mode {
  grid-template-rows: repeat(10, 1fr);
}

.buttons button {
  font-size: 20px;
  font-weight: 500;
  border: none;
  border-radius: 16px;
  color: #1f2937;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 50px;
  background: rgba(255, 255, 255, 0.6);
  box-shadow: 0 2px 5px rgba(0,0,0,0.05);
}
.buttons button:hover {
  background: rgba(255, 255, 255, 0.9);
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.08);
}
.buttons button:active {
  transform: scale(0.98);
}

/* Hide scientific buttons by default */
.buttons:not(.scientific-mode) .btn-sci {
  display: none;
}
/* Show scientific buttons and assign grid positions in scientific mode */
.buttons.scientific-mode .btn-sci {
  display: flex;
  background-color: rgba(243, 244, 246, 0.8);
  font-size: 13px;
  font-weight: 600;
  color: #4b5563;
}
/* Smaller buttons in scientific mode to fit more rows */
.buttons.scientific-mode button {
  min-height: 40px;
}
/* Memory buttons styling */
.buttons.scientific-mode .mem-store,
.buttons.scientific-mode .mem-recall,
.buttons.scientific-mode .mem-add {
  background-color: rgba(219, 234, 254, 0.8);
  color: #1d4ed8;
}

/* Scientific Grid Positions (Rows 1-5) */
.buttons.scientific-mode .sin { grid-column: 1 / 2; grid-row: 1 / 2; }
.buttons.scientific-mode .cos { grid-column: 2 / 3; grid-row: 1 / 2; }
.buttons.scientific-mode .tan { grid-column: 3 / 4; grid-row: 1 / 2; }
.buttons.scientific-mode .log { grid-column: 4 / 5; grid-row: 1 / 2; }
.buttons.scientific-mode .asin { grid-column: 1 / 2; grid-row: 2 / 3; }
.buttons.scientific-mode .acos { grid-column: 2 / 3; grid-row: 2 / 3; }
.buttons.scientific-mode .atan { grid-column: 3 / 4; grid-row: 2 / 3; }
.buttons.scientific-mode .ln { grid-column: 4 / 5; grid-row: 2 / 3; }
.buttons.scientific-mode .fact { grid-column: 1 / 2; grid-row: 3 / 4; }
.buttons.scientific-mode .pi { grid-column: 2 / 3; grid-row: 3 / 4; }
.buttons.scientific-mode .euler { grid-column: 3 / 4; grid-row: 3 / 4; }
.buttons.scientific-mode .abs-fn { grid-column: 4 / 5; grid-row: 3 / 4; }
.buttons.scientific-mode .sqrt { grid-column: 1 / 2; grid-row: 4 / 5; }
.buttons.scientific-mode .pow { grid-column: 2 / 3; grid-row: 4 / 5; }
.buttons.scientific-mode .paren-l { grid-column: 3 / 4; grid-row: 4 / 5; }
.buttons.scientific-mode .paren-r { grid-column: 4 / 5; grid-row: 4 / 5; }
.buttons.scientific-mode .mem-store { grid-column: 1 / 2; grid-row: 5 / 6; }
.buttons.scientific-mode .mem-recall { grid-column: 2 / 3; grid-row: 5 / 6; }
.buttons.scientific-mode .mem-add { grid-column: 3 / 4; grid-row: 5 / 6; }
.buttons.scientific-mode .toggle-basic { grid-column: 4 / 5; grid-row: 5 / 6; }


/* Button Colors */
.buttons .btn-digit { background-color: rgba(255, 255, 255, 0.8); }
.buttons .btn-op { 
    background-color: #fef3c7; 
    color: #d97706;
}
.buttons .btn-equal { 
    background-color: #3b82f6; 
    color: white;
}
.buttons .btn-equal:hover {
    background-color: #2563eb;
}
.buttons .ac { 
    background-color: #fee2e2; 
    color: #dc2626;
}
.buttons .sci-toggle { 
    background-color: #f3f4f6; 
    color: #4b5563;
    font-size: 16px; 
}

/* Basic Button Grid Positions (When NOT in scientific mode) */
.buttons:not(.scientific-mode) .ac { grid-column: 1 / 2; grid-row: 1 / 2; }
.buttons:not(.scientific-mode) .divide { grid-column: 2 / 3; grid-row: 1 / 2; }
.buttons:not(.scientific-mode) .multiply { grid-column: 3 / 4; grid-row: 1 / 2; }
.buttons:not(.scientific-mode) .backspace { grid-column: 4 / 5; grid-row: 1 / 2; }
.buttons:not(.scientific-mode) .seven { grid-column: 1 / 2; grid-row: 2 / 3; }
.buttons:not(.scientific-mode) .eight { grid-column: 2 / 3; grid-row: 2 / 3; }
.buttons:not(.scientific-mode) .nine { grid-column: 3 / 4; grid-row: 2 / 3; }
.buttons:not(.scientific-mode) .subtract { grid-column: 4 / 5; grid-row: 2 / 3; }
.buttons:not(.scientific-mode) .four { grid-column: 1 / 2; grid-row: 3 / 4; }
.buttons:not(.scientific-mode) .five { grid-column: 2 / 3; grid-row: 3 / 4; }
.buttons:not(.scientific-mode) .six { grid-column: 3 / 4; grid-row: 3 / 4; }
.buttons:not(.scientific-mode) .add { grid-column: 4 / 5; grid-row: 3 / 4; }
.buttons:not(.scientific-mode) .one { grid-column: 1 / 2; grid-row: 4 / 5; }
.buttons:not(.scientific-mode) .two { grid-column: 2 / 3; grid-row: 4 / 5; }
.buttons:not(.scientific-mode) .three { grid-column: 3 / 4; grid-row: 4 / 5; }
.buttons:not(.scientific-mode) .btn-equal { grid-column: 4 / 5; grid-row: 4 / 6; } /* Span rows 4+5 */
.buttons:not(.scientific-mode) .sci-toggle { grid-column: 1 / 2; grid-row: 5 / 6; }
.buttons:not(.scientific-mode) .btn-zero { grid-column: 2 / 3; grid-row: 5 / 6; } /* Corrected: Col 2 */
.buttons:not(.scientific-mode) .decimal { grid-column: 3 / 4; grid-row: 5 / 6; } /* Corrected: Col 3 */

/* Adjust Basic Button Grid Positions IN Scientific Mode (Shifted to rows 6-10) */
.buttons.scientific-mode .ac { grid-column: 1 / 2; grid-row: 6 / 7; }
.buttons.scientific-mode .divide { grid-column: 2 / 3; grid-row: 6 / 7; }
.buttons.scientific-mode .multiply { grid-column: 3 / 4; grid-row: 6 / 7; }
.buttons.scientific-mode .backspace { grid-column: 4 / 5; grid-row: 6 / 7; }
.buttons.scientific-mode .seven { grid-column: 1 / 2; grid-row: 7 / 8; }
.buttons.scientific-mode .eight { grid-column: 2 / 3; grid-row: 7 / 8; }
.buttons.scientific-mode .nine { grid-column: 3 / 4; grid-row: 7 / 8; }
.buttons.scientific-mode .subtract { grid-column: 4 / 5; grid-row: 7 / 8; }
.buttons.scientific-mode .four { grid-column: 1 / 2; grid-row: 8 / 9; }
.buttons.scientific-mode .five { grid-column: 2 / 3; grid-row: 8 / 9; }
.buttons.scientific-mode .six { grid-column: 3 / 4; grid-row: 8 / 9; }
.buttons.scientific-mode .add { grid-column: 4 / 5; grid-row: 8 / 9; }
.buttons.scientific-mode .one { grid-column: 1 / 2; grid-row: 9 / 10; }
.buttons.scientific-mode .two { grid-column: 2 / 3; grid-row: 9 / 10; }
.buttons.scientific-mode .three { grid-column: 3 / 4; grid-row: 9 / 10; }
.buttons.scientific-mode .btn-equal { grid-column: 4 / 5; grid-row: 9 / 11; }
.buttons.scientific-mode .sci-toggle { display: none; }
.buttons.scientific-mode .btn-zero { grid-column: 2 / 3; grid-row: 10 / 11; }
.buttons.scientific-mode .decimal { grid-column: 3 / 4; grid-row: 10 / 11; }

</style>
