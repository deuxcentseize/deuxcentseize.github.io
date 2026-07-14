"""
Stirling numbers of the first kind, generated purely from the gamma function.

This script contains NO combinatorics: no recurrences over Pascal-style
triangles, no factorization into cycles, no integer arithmetic on the way in.
The only inputs are floating-point evaluations of the polygamma functions
psi^(m)(x) = d^{m+1}/dx^{m+1} log Gamma(x), i.e. derivatives of the gamma
function -- and the exact Stirling numbers of the first kind come out.

The formula (Theorem A of RESULTS.md):

    [n]      (n-1)!
    [ ]  =  -------- * Y_{k-1}( w_1, w_2, ..., w_{k-1} ),
    [k]      (k-1)!

    where  w_j = psi^(j-1)(n) - psi^(j-1)(1)

and Y_m is the complete Bell polynomial, given by Y_0 = 1 and

    Y_j(w_1..w_j) = sum_{i=0}^{j-1} C(j-1, i) * Y_{j-1-i} * w_{i+1}.

Equivalently (Theorem A'):  [n k] = (1/(k-1)!) d^{k-1}/dx^{k-1} of
Gamma(n+x)/Gamma(1+x) at x = 0 -- the Stirling numbers ARE the Taylor
coefficients of a ratio of gamma functions, and expanding that derivative by
Faa di Bruno through log Gamma produces exactly the polygamma combination
above.

Run:  python polygamma_stirling.py [n]
"""

import sys

import mpmath as mp

mp.mp.dps = 80  # enough precision to round 20-digit integers exactly


def stirling1_row_from_polygamma(n):
    """Row [n 1], [n 2], ..., [n n] of unsigned Stirling numbers of the first
    kind, computed ONLY from numerical polygamma (log-gamma derivative)
    values, then rounded to exact integers."""
    # w_j = psi^{(j-1)}(n) - psi^{(j-1)}(1),  j = 1..n-1
    w = [mp.psi(j - 1, n) - mp.psi(j - 1, 1) for j in range(1, n)]

    # complete Bell polynomials Y_0..Y_{n-1} of (w_1, ..., w_{n-1})
    Y = [mp.mpf(1)] + [mp.mpf(0)] * (n - 1)
    for j in range(1, n):
        Y[j] = mp.fsum(mp.binomial(j - 1, i) * Y[j - 1 - i] * w[i]
                       for i in range(j))

    row = []
    for k in range(1, n + 1):
        val = mp.factorial(n - 1) / mp.factorial(k - 1) * Y[k - 1]
        nearest = int(mp.nint(val))
        row.append((nearest, float(abs(val - nearest))))
    return row


def exact_row(n):
    """Ground truth by the defining recurrence, for comparison only."""
    prev = [1]  # row 0: c(0,0)=1
    for m in range(n):
        cur = [0] * (m + 2)
        for k in range(m + 2):
            cur[k] = m * (prev[k] if k < len(prev) else 0) \
                     + (prev[k - 1] if 1 <= k <= len(prev) else 0)
        prev = cur
    return prev[1:]


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 20

    print(f"Unsigned Stirling numbers of the first kind, row n = {n},")
    print(f"computed from polygamma values psi^(m)(x) alone (mpmath, "
          f"{mp.mp.dps} digits):\n")

    row = stirling1_row_from_polygamma(n)
    truth = exact_row(n)
    width = len(str(max(truth)))
    all_ok = True
    for k, ((val, err), ref) in enumerate(zip(row, truth), start=1):
        ok = val == ref
        all_ok &= ok
        print(f"  [n={n}, k={k:>2}]  {val:>{width}}   "
              f"(rounding residue {err:.1e})  {'ok' if ok else 'MISMATCH'}")

    print()
    print("row sum check: sum_k [n k] =", sum(v for v, _ in row),
          "= n! =", int(mp.factorial(n)), ":",
          sum(v for v, _ in row) == int(mp.factorial(n)))
    print("all entries match defining recurrence:", all_ok)
