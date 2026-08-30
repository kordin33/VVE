/**
 * Math Solver Service - Wrapper for Python SymPy solver
 * Provides symbolic equation solving with LaTeX output
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../../logger';

const execFileAsync = promisify(execFile);

const SOLVER_PATH = path.join(__dirname, 'solver.py');
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

// SEC-001: Whitelist of allowed characters in equation input to prevent injection
const EQUATION_PATTERN = /^[a-zA-Z0-9\s\+\-\*\/\^\(\)\[\]\{\}=\.,<>!≤≥√πΣ⁰¹²³⁴⁵⁶⁷⁸⁹×÷]+$/;
const MAX_EQUATION_LENGTH = 500;

interface SolveResult {
    success: boolean;
    solutions?: string[];
    latex?: string;
    error?: string;
    original?: string;
}

interface SimplifyResult {
    success: boolean;
    result?: string;
    latex?: string;
    error?: string;
}

function validateInput(input: string): string | null {
    if (!input || typeof input !== 'string') {
        return 'Input is required';
    }
    if (input.length > MAX_EQUATION_LENGTH) {
        return `Input too long (max ${MAX_EQUATION_LENGTH} characters)`;
    }
    if (!EQUATION_PATTERN.test(input)) {
        return 'Input contains invalid characters';
    }
    return null;
}

/**
 * Solve an equation using SymPy
 * @param equation - The equation string (e.g., "x^2 - 5x + 6 = 0")
 * @returns Solution with LaTeX formatting
 */
export async function solveEquation(equation: string): Promise<SolveResult> {
    logger.info('[Math Solver] Solving equation', { length: equation.length });
    const startTime = Date.now();

    const validationError = validateInput(equation);
    if (validationError) {
        return { success: false, error: validationError };
    }

    try {
        // SEC-001: Use execFile instead of exec to prevent command injection.
        // execFile does NOT spawn a shell, so shell metacharacters are harmless.
        const { stdout, stderr } = await execFileAsync(
            PYTHON_CMD,
            [SOLVER_PATH, 'solve', equation],
            { timeout: 10000, encoding: 'utf8' }
        );

        if (stderr && !stdout) {
            logger.warn('[Math Solver] Python error', { stderr });
            return { success: false, error: stderr };
        }

        const result = JSON.parse(stdout.trim()) as SolveResult;
        const elapsed = Date.now() - startTime;
        logger.info('[Math Solver] Completed', { elapsed, success: result.success });

        return result;
    } catch (error: any) {
        logger.error('[Math Solver] Error', { message: error.message, code: error.code });

        if (error.code === 'ENOENT' || error.message?.includes('python')) {
            return {
                success: false,
                error: 'Python or SymPy not installed. Install with: pip install sympy'
            };
        }

        return {
            success: false,
            error: error.message || 'Unknown error solving equation'
        };
    }
}

/**
 * Simplify a mathematical expression
 * @param expression - The expression to simplify
 * @returns Simplified result with LaTeX
 */
export async function simplifyExpression(expression: string): Promise<SimplifyResult> {
    logger.info('[Math Solver] Simplifying expression', { length: expression.length });

    const validationError = validateInput(expression);
    if (validationError) {
        return { success: false, error: validationError };
    }

    try {
        // SEC-001: Use execFile instead of exec to prevent command injection
        const { stdout, stderr } = await execFileAsync(
            PYTHON_CMD,
            [SOLVER_PATH, 'simplify', expression],
            { timeout: 10000, encoding: 'utf8' }
        );

        if (stderr && !stdout) {
            return { success: false, error: stderr };
        }

        return JSON.parse(stdout.trim()) as SimplifyResult;
    } catch (error: any) {
        return {
            success: false,
            error: error.message || 'Unknown error simplifying expression'
        };
    }
}

/**
 * Check if Python and SymPy are available
 */
export async function checkMathSolverAvailable(): Promise<boolean> {
    try {
        const { stdout } = await execFileAsync(
            PYTHON_CMD,
            ['-c', 'import sympy; print("ok")'],
            { timeout: 5000 }
        );
        return stdout.trim() === 'ok';
    } catch {
        logger.warn('[Math Solver] Python/SymPy not available');
        return false;
    }
}
