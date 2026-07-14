"""
Comprehensive verification suite for RESULTS.md:
explicit formulations of the Stirling numbers of the first kind, and the
computational certificates behind the impossibility theorem (Theorem F).

Every check prints PASS/FAIL.  Exact checks use rational arithmetic
(fractions.Fraction / Python bigints); numeric checks use mpmath at high
precision and require agreement to well below 0.5 before rounding.

Run:  python verify_all.py
"""

import math
import time
from fractions import Fraction

import mpmath as mp

T0 = time.time()
FAILURES = []


def report(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}" + (f"  ({detail})" if detail else ""))
    if not ok:
        FAILURES.append(name)


# =============================================================================
# Ground truth: unsigned Stirling numbers of the first kind by the defining
# recurrence  c(n+1,k) = n*c(n,k) + c(n,k-1),  c(0,0) = 1.
# =============================================================================
NMAX = 120
c = [[0] * (NMAX + 2) for _ in range(NMAX + 2)]
c[0][0] = 1
for n in range(NMAX):
    for k in range(NMAX + 1):
        c[n + 1][k] = n * c[n][k] + (c[n][k - 1] if k >= 1 else 0)

report("ground truth sanity (OEIS A132393 spot values)",
       c[5][2] == 50 and c[5][3] == 35 and c[9][3] == 118124
       and c[10][4] == 723680 and c[7][1] == 720)


# =============================================================================
# Shared helpers
# =============================================================================
def H(n, r):
    """Generalized harmonic number H_n^{(r)} as an exact rational."""
    return sum(Fraction(1, m ** r) for m in range(1, n + 1))


def complete_bell_exact(ws):
    """[Y_0, ..., Y_m] for ws = [w_1, ..., w_m], via
    Y_j = sum_{i=0}^{j-1} C(j-1, i) * Y_{j-1-i} * w_{i+1}."""
    m = len(ws)
    Y = [Fraction(0)] * (m + 1)
    Y[0] = Fraction(1)
    for j in range(1, m + 1):
        Y[j] = sum(math.comb(j - 1, i) * Y[j - 1 - i] * ws[i] for i in range(j))
    return Y


# =============================================================================
# THEOREM A -- the polygamma / complete-Bell-polynomial formula
#
#   [n k] = (n-1)!/(k-1)! * Y_{k-1}(w_1, ..., w_{k-1}),
#   w_j   = psi^{(j-1)}(n) - psi^{(j-1)}(1) = (-1)^{j-1} (j-1)! H_{n-1}^{(j)}
# =============================================================================
NA = 40
ok = True
for n in range(1, NA + 1):
    ws = [Fraction((-1) ** (j - 1) * math.factorial(j - 1)) * H(n - 1, j)
          for j in range(1, n + 1)]
    Y = complete_bell_exact(ws)
    for k in range(1, n + 1):
        if Fraction(math.factorial(n - 1), math.factorial(k - 1)) * Y[k - 1] != c[n][k]:
            ok = False
report(f"Theorem A exact (Bell of harmonic numbers), all 1<=k<=n<={NA}", ok)

# Same theorem with w_j obtained *directly* from numerical polygamma values.
mp.mp.dps = 80
NPG = 24
ok = True
worst = mp.mpf(0)
for n in range(1, NPG + 1):
    ws = [mp.psi(j - 1, n) - mp.psi(j - 1, 1) for j in range(1, n + 1)]
    Y = [mp.mpf(1)] + [mp.mpf(0)] * len(ws)
    for j in range(1, len(ws) + 1):
        Y[j] = mp.fsum(mp.binomial(j - 1, i) * Y[j - 1 - i] * ws[i]
                       for i in range(j))
    for k in range(1, n + 1):
        val = mp.factorial(n - 1) / mp.factorial(k - 1) * Y[k - 1]
        err = abs(val - c[n][k])
        worst = max(worst, err)
        if err > mp.mpf("0.4"):
            ok = False
report(f"Theorem A numeric from mpmath polygamma, all 1<=k<=n<={NPG}", ok,
       f"worst abs error {mp.nstr(worst, 3)} at dps=80")

# Derivative form:  [n k] = (1/(k-1)!) * d^{k-1}/dx^{k-1} Gamma(n+x)/Gamma(1+x) | x=0
ok = True
for n in (3, 5, 8, 12, 15):
    for k in range(1, n + 1):
        d = mp.diff(lambda x: mp.gamma(n + x) / mp.gamma(1 + x), 0, k - 1)
        if abs(d / mp.factorial(k - 1) - c[n][k]) > mp.mpf("0.4"):
            ok = False
report("Theorem A' (derivative of Gamma-ratio at x=0), n in {3,5,8,12,15}", ok)

# Fully expanded partition sum (explicit form of Y_{k-1}):
#   [n k] = (n-1)! * sum over m_1+2m_2+...=k-1 of
#           prod_j ((-1)^{j-1} H_{n-1}^{(j)} / j)^{m_j} / m_j!
def partitions_mult(m):
    """Yield multiplicity vectors (m_1,...,m_m) with sum j*m_j = m."""
    def rec(rem, maxpart):
        if rem == 0:
            yield {}
            return
        for j in range(min(rem, maxpart), 0, -1):
            for cnt in range(rem // j, 0, -1):
                for rest in rec(rem - j * cnt, j - 1):
                    d = dict(rest)
                    d[j] = cnt
                    yield d
    yield from rec(m, m)

ok = True
for n in range(1, 19):
    hs = [None] + [H(n - 1, j) for j in range(1, n + 1)]
    for k in range(1, n + 1):
        total = Fraction(0)
        for lam in partitions_mult(k - 1) if k > 1 else [{}]:
            term = Fraction(1)
            for j, mj in lam.items():
                term *= (Fraction((-1) ** (j - 1)) * hs[j] / j) ** mj \
                        / math.factorial(mj)
            total += term
        if math.factorial(n - 1) * total != c[n][k]:
            ok = False
report("Theorem A'' (explicit partition sum), all 1<=k<=n<=18", ok)


# =============================================================================
# THEOREM B -- symmetric-function and Hessenberg-determinant forms
#   [n k] = e_{n-k}(1,2,...,n-1) = (n-1)! e_{k-1}(1, 1/2, ..., 1/(n-1))
# =============================================================================
NB = 120
ok = True
for n in range(1, NB + 1):
    poly = [1]                      # expand prod_{m=1}^{n-1} (x + m), ascending
    for m in range(1, n):
        new = [0] * (len(poly) + 1)
        for i, a in enumerate(poly):
            new[i] += a * m
            new[i + 1] += a
        poly = new
    for k in range(1, n + 1):
        if poly[k - 1] != c[n][k]:
            ok = False
report(f"Theorem B (elementary symmetric polynomials), all 1<=k<=n<={NB}", ok)

def e_via_hessenberg(ps, m):
    """e_m from power sums via the Newton-identity Hessenberg determinant."""
    if m == 0:
        return Fraction(1)
    M = [[Fraction(0)] * m for _ in range(m)]
    for i in range(m):
        for j in range(m):
            if j == i + 1:
                M[i][j] = Fraction(i + 1)
            elif j <= i:
                M[i][j] = ps[i - j + 1]
    # exact determinant, fraction-free-ish Gaussian elimination
    A = [row[:] for row in M]
    det = Fraction(1)
    for col in range(m):
        piv = next((r for r in range(col, m) if A[r][col] != 0), None)
        if piv is None:
            return Fraction(0)
        if piv != col:
            A[col], A[piv] = A[piv], A[col]
            det = -det
        det *= A[col][col]
        inv = Fraction(1) / A[col][col]
        for r in range(col + 1, m):
            f = A[r][col] * inv
            if f:
                for cc in range(col, m):
                    A[r][cc] -= f * A[col][cc]
    return det / math.factorial(m)

ok = True
for n in range(2, 15):
    ps = [None] + [H(n - 1, j) for j in range(1, n)]
    for k in range(1, n + 1):
        if k - 1 < len(ps):
            val = math.factorial(n - 1) * e_via_hessenberg(ps, k - 1)
            if val != c[n][k]:
                ok = False
report("Theorem B' (Hessenberg determinant of harmonic numbers), n<=14", ok)


# =============================================================================
# THEOREM C -- Schlaefli's double sum (1852): with S(m,j) the second kind,
#   s(n,k) = (-1)^{n-k} [n k]
#          = sum_{j=0}^{n-k} (-1)^j C(n-1+j, n-k+j) C(2n-k, n-k-j) S(n-k+j, j)
# and S(m,j) = (1/j!) sum_i (-1)^i C(j,i) (j-i)^m  -- an explicit double sum.
# =============================================================================
def S2(m, j):
    if j < 0 or j > m:
        return 0
    return sum((-1) ** i * math.comb(j, i) * (j - i) ** m
               for i in range(j + 1)) // math.factorial(j)

NC = 30
ok = True
for n in range(1, NC + 1):
    for k in range(1, n + 1):
        v = sum((-1) ** j * math.comb(n - 1 + j, n - k + j)
                * math.comb(2 * n - k, n - k - j) * S2(n - k + j, j)
                for j in range(n - k + 1))
        if v != (-1) ** (n - k) * c[n][k]:
            ok = False
report(f"Theorem C (Schlaefli explicit double sum), all 1<=k<=n<={NC}", ok)


# =============================================================================
# THEOREM D -- generating function and contour integral
#   sum_{n>=k} [n k] t^n/n! = (-log(1-t))^k / k!         (exact, formal)
#   [n k] = n!/(k! 2 pi) int_0^{2pi} (-log(1-r e^{i a}))^k (r e^{i a})^{-n} da
# =============================================================================
ND = 40
ell = [Fraction(0)] + [Fraction(1, m) for m in range(1, ND + 1)]   # -log(1-t)
ok = True
power = [Fraction(1)] + [Fraction(0)] * ND                          # ell^0
for k in range(1, ND + 1):
    new = [Fraction(0)] * (ND + 1)
    for i in range(ND + 1):
        if power[i] == 0:
            continue
        for j in range(1, ND + 1 - i):
            new[i + j] += power[i] * ell[j]
    power = new                                                     # ell^k
    for n in range(k, ND + 1):
        if Fraction(math.factorial(n), math.factorial(k)) * power[n] != c[n][k]:
            ok = False
report(f"Theorem D (EGF (-log(1-t))^k/k!), exact, all 1<=k<=n<={ND}", ok)

mp.mp.dps = 30
ok = True
for (n, k) in [(5, 2), (8, 3), (10, 4), (12, 7), (15, 5)]:
    r = mp.mpf(1) / 2
    f = lambda a: (-mp.log(1 - r * mp.exp(1j * a))) ** k * mp.exp(-1j * n * a)
    I = mp.quad(f, [0, 2 * mp.pi]) / (2 * mp.pi * r ** n)
    val = mp.factorial(n) / mp.factorial(k) * I.real
    if abs(val - c[n][k]) > 1e-6 * max(1, c[n][k]):
        ok = False
report("Theorem D' (contour integral, numeric), 5 spot checks", ok)


# =============================================================================
# THEOREM E -- diagonal closed forms via second-order Eulerian numbers:
#   [n, n-m] = sum_k <<m k>> C(n+k, 2m)      (polynomial in n of degree 2m)
# =============================================================================
NE = 40
E2 = [[0] * (NE + 1) for _ in range(NE + 1)]
E2[0][0] = 1
for n in range(1, NE + 1):
    for k in range(n):
        E2[n][k] = (k + 1) * E2[n - 1][k] \
                   + (2 * n - 1 - k) * (E2[n - 1][k - 1] if k >= 1 else 0)

ok = True
for n in range(1, NE + 1):
    for m in range(n):
        val = sum(E2[m][kk] * math.comb(n + kk, 2 * m)
                  for kk in range(max(m, 1)))
        if val != c[n][n - m]:
            ok = False
report(f"Theorem E (second-order Eulerian diagonals), all 0<=m<n<={NE}", ok)


# =============================================================================
# THEOREM F -- computational certificates for the impossibility theorem
# =============================================================================
import sympy as sp
from sympy.abc import n as sn, k as sk
from sympy.concrete.gosper import gosper_sum
from sympy.solvers.recurr import rsolve_hyper

# (i) Gosper's algorithm: sum 1/k has NO hypergeometric antidifference,
#     i.e. H_n is not expressible as hypergeometric-term telescoping.
g = gosper_sum(1 / sk, (sk, 1, sn))
report("Certificate (i): gosper_sum(1/k,(k,1,n)) has no closed form", g is None,
       f"returned {g!r}")

# (ii) Petkovsek's algorithm on the minimal annihilator of H_n:
#      (n+1) y(n) - (2n+3) y(n+1) + (n+2) y(n+2) = 0.
#      Full solution space is span{1, H_n}; ALL hypergeometric solutions
#      must be constants.
sol = rsolve_hyper([sn + 1, -(2 * sn + 3), sn + 2], 0, sn)
is_const = sol is not None and sp.simplify(sp.diff(sol, sn)) == 0
report("Certificate (ii): hypergeometric solutions of H_n-annihilator are "
       "constants only", is_const, f"rsolve_hyper -> {sol}")

# sanity: H_n really satisfies that recurrence
ok = all(Fraction(m + 1) * H(m, 1) - Fraction(2 * m + 3) * H(m + 1, 1)
         + Fraction(m + 2) * H(m + 2, 1) == 0 for m in range(1, 60))
report("Certificate (ii) sanity: H_n satisfies the order-2 recurrence", ok)

# (iii) Petkovsek's algorithm on L^2, the annihilator of c(n+1,2) = n! H_n:
#       y(n+2) - (2n+3) y(n+1) + (n+1)^2 y(n) = 0.
#       Solution space is span{n!, n! H_n}; the ONLY hypergeometric
#       line is C * n!  ==>  c(n,2) is not hypergeometric.
sol2 = rsolve_hyper([(sn + 1) ** 2, -(2 * sn + 3), sp.Integer(1)], 0, sn)
ok = sol2 is not None
detail = f"rsolve_hyper -> {sol2}"
if ok:
    # the returned basis must be a constant multiple of n!
    ratio = sp.simplify(sol2 / sp.factorial(sn))
    ok = sp.simplify(sp.diff(ratio, sn)) == 0
report("Certificate (iii): hypergeometric solutions of the c(n,2)-annihilator "
       "L^2 are C*n! only", ok, detail)

# (iii-b) independent ground truth: compare the recurrence table against
#         sympy's own stirling(n, k, kind=1) for a broad range
ok = all(c[m][kk] == sp.functions.combinatorial.numbers.stirling(
             m, kk, kind=1, signed=False)
         for m in range(26) for kk in range(m + 1))
report("Independent ground truth: table == sympy stirling(kind=1), n<=25", ok)

# sanity: c(n,2) satisfies L^2 y = 0 and is NOT proportional to (n-1)!
ok = all(c[m + 2][2] - (2 * m + 1) * c[m + 1][2] + m * m * c[m][2] == 0
         for m in range(1, 100))
ok = ok and len({Fraction(c[m][2], math.factorial(m - 1))
                 for m in range(2, 30)}) == 28
report("Certificate (iii) sanity: c(n,2) solves L^2=0, c(n,2)/(n-1)! "
       "strictly non-constant", ok)

# (iv) the ladder identity behind Theorem F:  (L y)(n) = y(n+1) - n y(n)
#      maps column k to column k-1, hence L^k annihilates column k.
ok = all(c[m + 1][kk] - m * c[m][kk] == c[m][kk - 1]
         for m in range(1, NMAX) for kk in range(1, m + 2))
ok = ok and all(c[m][0] == 0 for m in range(1, NMAX))
report("Ladder identity: (S - n) lowers the column index; L^k kills column k",
       ok)

# (v) strict growth used at the end of Theorem F's proof:
#     c(n,k)/(n-1)! is strictly increasing in n for fixed k>=2
ok = all(Fraction(c[m + 1][kk], math.factorial(m)) >
         Fraction(c[m][kk], math.factorial(m - 1))
         for kk in range(2, 12) for m in range(kk, 60))
report("Growth: c(n,k)/(n-1)! strictly increasing (k=2..11, n<=60)", ok)


# =============================================================================
# Info: asymptotics from Theorem A (not a PASS/FAIL check)
# =============================================================================
print()
mp.mp.dps = 30
for k in (2, 3, 4):
    n = 500
    exact = Fraction(c[NMAX][k], math.factorial(NMAX - 1))  # at n = NMAX
    lead = (mp.log(NMAX - 1) + mp.euler) ** (k - 1) / mp.factorial(k - 1)
    print(f"info: n={NMAX}, k={k}:  c/(n-1)! = "
          f"{mp.nstr(mp.mpf(exact.numerator) / exact.denominator, 8)}   "
          f"leading asymptotic (ln n + gamma)^(k-1)/(k-1)! = {mp.nstr(lead, 8)}")

print()
elapsed = time.time() - T0
if FAILURES:
    print(f"RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}   [{elapsed:.1f}s]")
    raise SystemExit(1)
print(f"RESULT: ALL CHECKS PASSED   [{elapsed:.1f}s]")
