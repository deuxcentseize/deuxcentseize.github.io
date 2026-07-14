# Explicit Formulations of the Stirling Numbers of the First Kind — and a Precise Impossibility Theorem

*Prepared for Jet (jetshandpease@gmail.com), 2026-07-07.*

**Files in this directory:**

| File | Contents |
|---|---|
| `RESULTS.md` | this document: theorems, proofs, discussion |
| `verify_all.py` | verification suite for every claim below (exact rational arithmetic + 80-digit numerics) |
| `verification_log.txt` | output of a full run — all 19 checks PASS |
| `polygamma_stirling.py` | demo: exact Stirling numbers generated *purely* from numerical polygamma values |

---

## 0. Executive summary

The task was: *find an explicit formulation of the Stirling numbers of the first kind, or prove that none can exist* — with the hint that derivatives of "some permutation of the gamma function, perhaps with an additional logarithm" should generate them.

The answer is **both**, and the hint is **correct** — it is in fact the key to the constructive half:

1. **The conjecture holds, exactly as guessed** (Theorem A). The unsigned Stirling numbers of the first kind are, with *no correction factors whatsoever*,

$$\begin{bmatrix}n\\k\end{bmatrix} \;=\; \frac{(n-1)!}{(k-1)!}\; Y_{k-1}\Big(\psi(n)-\psi(1),\;\psi'(n)-\psi'(1),\;\ldots,\;\psi^{(k-2)}(n)-\psi^{(k-2)}(1)\Big),$$

   where $\psi^{(m)}$ are the polygamma functions (the derivatives of $\log\Gamma$) and $Y_m$ is the complete Bell polynomial. Equivalently, they are literally the Taylor coefficients of a ratio of gamma functions:

$$\begin{bmatrix}n\\k\end{bmatrix} \;=\; \frac{1}{(k-1)!}\,\frac{d^{k-1}}{dx^{k-1}}\Bigg|_{x=0}\frac{\Gamma(n+x)}{\Gamma(1+x)}.$$

   The "additional logarithm" is exactly what turns the gamma ratio into polygamma data: differentiating through $\exp(\log\Gamma(n+x)-\log\Gamma(1+x))$ via Faà di Bruno produces the Bell-polynomial combination above. This was verified exactly (rational arithmetic) for all $1\le k\le n\le 40$, and *numerically realized*: `polygamma_stirling.py` recovers entire rows of exact 18-digit Stirling numbers from floating-point polygamma evaluations alone.

2. **Several other fully explicit formulations exist** (Theorems B–E): elementary symmetric polynomials, a Hessenberg determinant whose entries are polygamma differences, Schläfli's 1852 explicit finite double sum, a contour integral, and — along diagonals — genuine polynomial closed forms.

3. **A rigorous impossibility theorem also holds** (Theorem F). In the standard formal sense of "closed form" for combinatorial sequences (the Petkovšek–Wilf–Zeilberger framework): for every fixed $k\ge 2$, the column sequence $n\mapsto{n\brack k}$ is **not** expressible as any finite linear combination of hypergeometric terms. The Stirling numbers of the *second* kind famously are — $S(n,k)=\frac1{k!}\sum_{i=0}^{k}(-1)^i\binom{k}{i}(k-i)^n$ is a sum of $k+1$ hypergeometric terms in $n$ — so this theorem locates the exact formal boundary that separates the two kinds. A complete, self-contained proof is given in §6, with machine certificates (Gosper's and Petkovšek's algorithms) in the verification suite.

There is no contradiction between (1)–(2) and (3): "explicit formula" is not an absolute notion. The formulas of Theorems A–D all involve either a number of terms that grows with $n,k$ (double sums, partition sums) or transcendental data (polygamma values, i.e. *one level of indefinite summation*: harmonic numbers). Theorem F proves that this one extra level is genuinely unavoidable. The Stirling numbers of the first kind sit exactly one rung above hypergeometric closed forms on the d'Alembertian ladder — and both the rung and the impossibility of stepping down from it are now proved.

---

## 1. Notation and the master identity

Let $s(n,k)$ denote the signed and ${n\brack k}=c(n,k)=|s(n,k)|=(-1)^{n-k}s(n,k)$ the unsigned Stirling numbers of the first kind: $c(n,k)$ counts permutations of $n$ elements with exactly $k$ cycles, with the defining recurrence

$$c(n+1,k)=n\,c(n,k)+c(n,k-1),\qquad c(0,0)=1 .$$

**Proposition 1 (row polynomials are gamma ratios).** For $n\ge 0$,

$$\sum_{k=0}^{n} c(n,k)\,x^{k} \;=\; x^{\overline{n}} \;:=\; x(x+1)\cdots(x+n-1)\;=\;\frac{\Gamma(x+n)}{\Gamma(x)} .$$

*Proof.* Induction: multiplying $x^{\overline n}$ by $(x+n)$ makes the coefficients satisfy exactly the defining recurrence, with matching initial row. The gamma form is the functional equation $\Gamma(x+1)=x\Gamma(x)$ iterated $n$ times. $\blacksquare$

So the gamma function *already contains every Stirling number of the first kind as Taylor data*: the entire problem is coefficient extraction from $\Gamma(x+n)/\Gamma(x)$. Summing Proposition 1 against $t^n/n!$ gives the binomial series and the two-variable **master identity**

$$(1-t)^{-x}\;=\;\sum_{n\ge0}\frac{\Gamma(x+n)}{\Gamma(x)\,n!}\,t^{n}\;=\;\sum_{n,k} c(n,k)\,x^{k}\,\frac{t^{n}}{n!},\qquad |t|<1 .$$

Every formula in this document is a route through this identity: extract $t$-coefficients first and you meet gamma ratios (§2); extract $x$-coefficients first and you meet powers of $-\log(1-t)$ (§5) — the conjectured "additional logarithm."

---

## 2. Theorem A: the polygamma formula (the conjecture, proved)

Write $\psi^{(m)}(x)=\dfrac{d^{m+1}}{dx^{m+1}}\log\Gamma(x)$ for the polygamma functions ($\psi^{(0)}=\psi$), and let $Y_m$ be the **complete Bell polynomials**, defined by $Y_0=1$ and either of

$$\exp\Big(\sum_{j\ge1}w_j\frac{x^j}{j!}\Big)=\sum_{m\ge0}Y_m(w_1,\dots,w_m)\frac{x^m}{m!},\qquad
Y_{j}=\sum_{i=0}^{j-1}\binom{j-1}{i}\,Y_{j-1-i}\,w_{i+1}.$$

> **Theorem A.** For all $1\le k\le n$, with
> $$w_j \;=\; \psi^{(j-1)}(n)-\psi^{(j-1)}(1),\qquad j=1,\dots,k-1,$$
> the unsigned Stirling numbers of the first kind are
> $$\begin{bmatrix}n\\k\end{bmatrix}=\frac{(n-1)!}{(k-1)!}\,Y_{k-1}(w_1,w_2,\dots,w_{k-1}).$$

Note what is *not* here: no signs, no extra factorials, no correction terms. The arguments of the Bell polynomial are the raw differences of consecutive derivatives of $\log\Gamma$ between the points $n$ and $1$.

**Proof.** By Proposition 1, $\sum_k c(n,k)x^k = x\prod_{m=1}^{n-1}(x+m)$, so

$$c(n,k)\;=\;[x^{k-1}]\;\prod_{m=1}^{n-1}(x+m)\;=\;(n-1)!\;[x^{k-1}]\;\prod_{m=1}^{n-1}\Big(1+\frac{x}{m}\Big).$$

For $|x|<1$ take logarithms and expand each factor:

$$\log\prod_{m=1}^{n-1}\Big(1+\frac xm\Big)=\sum_{m=1}^{n-1}\sum_{j\ge1}\frac{(-1)^{j-1}}{j}\frac{x^j}{m^j}
=\sum_{j\ge1}\frac{(-1)^{j-1}H^{(j)}_{n-1}}{j}\,x^j,$$

where $H^{(j)}_{n-1}=\sum_{m=1}^{n-1}m^{-j}$ are generalized harmonic numbers. Setting $w_j=(-1)^{j-1}(j-1)!\,H^{(j)}_{n-1}$ makes the exponent equal $\sum_j w_j x^j/j!$, so by the defining identity of $Y_m$,

$$\prod_{m=1}^{n-1}\Big(1+\frac{x}{m}\Big)=\sum_{m\ge0}Y_m(w_1,\dots,w_m)\frac{x^m}{m!}
\quad\Longrightarrow\quad
c(n,k)=\frac{(n-1)!}{(k-1)!}Y_{k-1}(w_1,\dots,w_{k-1}).$$

It remains to identify $w_j$ with polygamma differences. Differentiating $\log\Gamma(x+1)=\log\Gamma(x)+\log x$ exactly $j-1$ times gives $\psi^{(j-1)}(x+1)=\psi^{(j-1)}(x)+(-1)^{j-1}(j-1)!\,x^{-j}$; telescoping from $x=1$ to $x=n-1$:

$$\psi^{(j-1)}(n)-\psi^{(j-1)}(1)=(-1)^{j-1}(j-1)!\sum_{m=1}^{n-1}m^{-j}=(-1)^{j-1}(j-1)!\,H^{(j)}_{n-1}=w_j. \qquad\blacksquare$$

**Theorem A′ (derivative form).** $G_n(x):=\Gamma(n+x)/\Gamma(1+x)=\prod_{m=1}^{n-1}(x+m)$ is a polynomial, and

$$\begin{bmatrix}n\\k\end{bmatrix}=\frac{G_n^{(k-1)}(0)}{(k-1)!}
=\frac{1}{(k-1)!}\,\frac{d^{k-1}}{dx^{k-1}}\Bigg|_{x=0}\frac{\Gamma(n+x)}{\Gamma(1+x)} .$$

Applying Faà di Bruno to $G_n=\exp(\log\Gamma(n+x)-\log\Gamma(1+x))$ — i.e., differentiating the gamma ratio *through its logarithm* — reproduces Theorem A verbatim, since the inner derivatives are precisely $\psi^{(j-1)}(n+x)-\psi^{(j-1)}(1+x)$ evaluated at $x=0$. This is the exact formal content of the original hunch: *derivatives of a (ratio-)permutation of the gamma function, routed through an additional logarithm, have the Stirling numbers of the first kind as their polynomial coefficients.*

**Theorem A″ (fully expanded, explicit finite sum).** Expanding $Y_{k-1}$ over partitions of $k-1$ (written as multiplicity vectors $m_1+2m_2+3m_3+\cdots=k-1$):

$$\begin{bmatrix}n\\k\end{bmatrix}=(n-1)!\!\!\sum_{m_1+2m_2+\cdots=k-1}\;\prod_{j\ge1}\frac{1}{m_j!}\left(\frac{(-1)^{j-1}H^{(j)}_{n-1}}{j}\right)^{m_j}.$$

**First instances** (using $\psi(1)=-\gamma$, $\psi'(1)=\pi^2/6$, $\psi''(1)=-2\zeta(3)$):

$$\begin{aligned}
\begin{bmatrix}n\\1\end{bmatrix}&=(n-1)! \\[2pt]
\begin{bmatrix}n\\2\end{bmatrix}&=(n-1)!\,\big(\psi(n)+\gamma\big)=(n-1)!\,H_{n-1} \\[2pt]
\begin{bmatrix}n\\3\end{bmatrix}&=\frac{(n-1)!}{2}\Big[(\psi(n)+\gamma)^2+\psi'(n)-\frac{\pi^2}{6}\Big]
=\frac{(n-1)!}{2}\Big[H_{n-1}^2-H^{(2)}_{n-1}\Big] \\[2pt]
\begin{bmatrix}n\\4\end{bmatrix}&=\frac{(n-1)!}{6}\Big[(\psi(n)+\gamma)^3+3(\psi(n)+\gamma)\Big(\psi'(n)-\frac{\pi^2}{6}\Big)+\psi''(n)+2\zeta(3)\Big].
\end{aligned}$$

**Verification.** Exact for all $1\le k\le n\le 40$ (rational arithmetic); partition form exact for $n\le18$; derivative form numerically at $n\in\{3,5,8,12,15\}$, all $k$; and — most strikingly — `polygamma_stirling.py` computes rows of *exact integer* Stirling numbers from nothing but `mpmath.psi(m, x)` floating-point calls (row $n=20$: all twenty 1-to-18-digit entries exact, rounding residues $\sim10^{-64}$ at 80 digits).

**Remark (the $\zeta$ limit and asymptotics).** As $n\to\infty$, $w_1 = H_{n-1}\sim\ln n+\gamma$ diverges while every deeper argument converges: $H^{(j)}_{n-1}\to\zeta(j)$, i.e. $w_j\to-\psi^{(j-1)}(1)$. Since $\log\Gamma(1+x)=-\gamma x+\sum_{j\ge2}\tfrac{(-1)^j\zeta(j)}{j}x^j$, the deep arguments assemble into $e^{-\gamma x}/\Gamma(1+x)$, giving

$$\frac{1}{(n-1)!}\begin{bmatrix}n\\k\end{bmatrix}\;\longrightarrow\;[x^{k-1}]\;e^{H_{n-1}x}\,\frac{e^{-\gamma x}}{\Gamma(1+x)}
\;=\;\sum_{i=0}^{k-1}\frac{H_{n-1}^{\,i}}{i!}\,g_{k-1-i},\qquad g_m=[x^m]\frac{e^{-\gamma x}}{\Gamma(1+x)},$$

with leading term $\dfrac{(\ln n+\gamma)^{k-1}}{(k-1)!}$ — the classical asymptotic, visible in the numerics in `verification_log.txt`. So the row-limit of the Stirling triangle *is* the reciprocal gamma function: the two objects generate each other in both directions.

---

## 3. Theorem B: symmetric functions and a polygamma determinant

> **Theorem B.** $\displaystyle{n\brack k}=e_{n-k}(1,2,\dots,n-1)=(n-1)!\;e_{k-1}\Big(1,\tfrac12,\dots,\tfrac1{n-1}\Big)$,
> where $e_j$ is the elementary symmetric polynomial.

*Proof.* Vieta on $\prod_{m=1}^{n-1}(x+m)$, in both normalizations. $\blacksquare$ (Verified exactly for all $1\le k\le n\le120$.)

Newton's identities convert $e_{k-1}$ of the reciprocals into a determinant in the power sums $p_j=H^{(j)}_{n-1}=\frac{(-1)^{j-1}}{(j-1)!}\big(\psi^{(j-1)}(n)-\psi^{(j-1)}(1)\big)$:

> **Theorem B′.** $\displaystyle {n\brack k}=\frac{(n-1)!}{(k-1)!}\;
> \det\begin{pmatrix}
> p_1 & 1 & & \\
> p_2 & p_1 & 2 & \\
> \vdots & & \ddots & k-2\\
> p_{k-1} & p_{k-2} & \cdots & p_1
> \end{pmatrix}_{(k-1)\times(k-1)} .$

A $(k-1)\times(k-1)$ Hessenberg determinant **whose every entry is a polygamma difference** — a second, linear-algebraic realization of the conjecture. (Verified exactly for $n\le14$.)

---

## 4. Theorem C: Schläfli's explicit double sum (1852)

The oldest "explicit formula," expressing first kind through second kind:

> **Theorem C.** With $S(m,j)$ the Stirling numbers of the second kind,
> $$s(n,k)=(-1)^{n-k}{n\brack k}=\sum_{j=0}^{n-k}(-1)^{j}\binom{n-1+j}{n-k+j}\binom{2n-k}{n-k-j}\,S(n-k+j,\,j),$$
> and inserting $S(m,j)=\frac1{j!}\sum_{i=0}^{j}(-1)^i\binom{j}{i}(j-i)^m$ yields the completely elementary finite double sum
> $$ {n\brack k}=(-1)^{n-k}\sum_{j=0}^{n-k}\sum_{i=0}^{j}\frac{(-1)^{j+i}}{j!}\binom{n-1+j}{n-k+j}\binom{2n-k}{n-k-j}\binom{j}{i}\,(j-i)^{\,n-k+j}. $$

Classical (Schläfli 1852; Gould 1960; NIST DLMF §26.8); verified here exactly for all $1\le k\le n\le30$. Note the inner structure: the number of summands is governed by $n-k$, not by a constant — by Theorem F below, this growth is *necessary*.

---

## 5. Theorem D: the logarithm, and an integral representation

Extracting $x$-coefficients from the master identity first:

> **Theorem D.** $\displaystyle\frac{\partial^k}{\partial x^k}\Big|_{x=0}(1-t)^{-x}=\big(-\log(1-t)\big)^k$, hence
> $$\sum_{n\ge k}{n\brack k}\frac{t^n}{n!}=\frac{\big(-\log(1-t)\big)^k}{k!}
> \qquad\text{and}\qquad
> {n\brack k}=\frac{n!}{k!}\cdot\frac{1}{2\pi i}\oint_{|t|=r<1}\frac{\big(-\log(1-t)\big)^k}{t^{n+1}}\,dt .$$

*Proof.* $(1-t)^{-x}=e^{-x\log(1-t)}$; differentiate in $x$ at $0$; Cauchy's coefficient formula. $\blacksquare$ (EGF verified exactly to $n\le40$; the integral numerically at five $(n,k)$ pairs.)

This is the cleanest statement of where the conjectured "additional logarithm" lives, and of the symmetry with the second kind:

$$\text{second kind: } \frac{(e^t-1)^k}{k!} \qquad\longleftrightarrow\qquad \text{first kind: } \frac{(-\log(1-t))^k}{k!},$$

the two base functions being compositional inverses of one another (equivalently: the two Stirling matrices are mutually inverse). The decisive *asymmetry*: $(e^t-1)^k$ expands by the binomial theorem into $k+1$ pure exponentials $e^{jt}$, whose Taylor coefficients $j^n/n!$ are hypergeometric in $n$ — that *is* the second kind's closed form. Powers of the logarithm admit no such finite decomposition; Theorem F makes that a theorem, not an impression.

---

## 6. Theorem E: true closed forms along the diagonals

Columns are the hard direction. Along diagonals, closed forms exist:

> **Theorem E** (Concrete Mathematics, eq. (6.44)). With $\left\langle\!\left\langle m\atop j\right\rangle\!\right\rangle$ the second-order Eulerian numbers,
> $$\begin{bmatrix}n\\n-m\end{bmatrix}=\sum_{j=0}^{m-1}\left\langle\!\!\left\langle{m\atop j}\right\rangle\!\!\right\rangle\binom{n+j}{2m},$$
> which for each fixed $m$ is a **polynomial in $n$ of degree $2m$**: ${n\brack n-1}=\binom n2$, ${n\brack n-2}=\frac{3n-1}{4}\binom n3$, etc.

Classical; verified exactly here for all $0\le m<n\le40$. So the precise geography is: *diagonals — polynomial; columns — provably beyond hypergeometric closed form (next section); everywhere — explicit at the price of one level of summation depth (Theorems A–D).*

---

## 7. Theorem F: the impossibility theorem

### 7.1 What "no explicit formula" can rigorously mean

"Closed form" must be formalized before non-existence can be proved; the accepted framework (Petkovšek–Wilf–Zeilberger, *A=B*) is:

> **Definition.** A sequence $h$ (defined for $n\ge n_0$) is a **hypergeometric term** if $h(n)\ne0$ for all large $n$ and $h(n+1)/h(n)$ agrees, for all large $n$, with a fixed rational function $r\in\mathbb{C}(n)$. Two hypergeometric terms are **similar** if their ratio agrees with a rational function for large $n$. Let $\mathcal H$ be the class of sequences expressible, for all large $n$, as a **finite sum of hypergeometric terms**.

$\mathcal H$ contains everything ordinarily called a closed form in $n$: rational functions, $a^n$, $n!$, $\Gamma(an+b)$ ($a\in\mathbb Z$), binomials $\binom{an+b}{cn+d}$, all products and quotients thereof, rational-coefficient combinations, and any *fixed-length* sum of such — e.g. $S(n,k)=\frac{1}{k!}\sum_{i=0}^{k}(-1)^i\binom ki (k-i)^n \in\mathcal H$ for each fixed $k$. Formulas whose number of terms grows with $n$ (Theorems A″, C) are *not* single elements of $\mathcal H$; that is exactly the boundary being probed.

> **Theorem F.** For every fixed $k\ge2$, the column sequence $n\mapsto{n\brack k}$ is **not** in $\mathcal H$: it is not equal, for large $n$, to any finite sum of hypergeometric terms. The same holds for the signed sequence $s(n,k)$.

Contrast: column $k$ of the *second* kind lies in $\mathcal H$ with $k+1$ terms. No analogue with any fixed number of terms — however large — exists for the first kind. In particular there is no formula of the shape ${n\brack k}=\sum_{i=1}^{M}r_i(n)\,a_i^{\,n}\,\prod_j\Gamma(\alpha_{ij}n+\beta_{ij})^{\pm1}$ with $M$ fixed, rational $r_i$ and integer $\alpha_{ij}$.

### 7.2 The ladder operator

Define $(Ly)(n)=y(n+1)-n\,y(n)$. The defining recurrence $c(n+1,k)=n\,c(n,k)+c(n,k-1)$ says precisely that **$L$ lowers the column index**:

$$L\,c(\cdot,k)=c(\cdot,k-1)\quad\Longrightarrow\quad L^{k}\,c(\cdot,k)=c(\cdot,0)=0\ \text{ on } n\ge1 .$$

(Verified for the whole table $n\le120$.) So column $k$ is annihilated by the $k$-th power of a single first-order operator — this makes it *d'Alembertian* (Abramov–Petkovšek), and Theorem F will show it is not anything simpler.

### 7.3 Three lemmas

> **Lemma 1 (dissimilar terms are independent).** If $h_1,\dots,h_M$ are pairwise dissimilar hypergeometric terms with $h_1(n)+\cdots+h_M(n)=0$ for all large $n$, then $M=0$.

*Proof.* Induction on $M$. $M=1$ is impossible: hypergeometric terms are eventually nonzero. Let $M\ge2$, with ratios $r_i(n)=h_i(n+1)/h_i(n)$. Evaluating the relation at $n+1$ and subtracting $r_M(n)$ times the relation at $n$:

$$\sum_{i=1}^{M-1}\big(r_i(n)-r_M(n)\big)h_i(n)=0\qquad(\text{all large }n).$$

If some $r_i\equiv r_M$, then $(h_i/h_M)(n+1)=(h_i/h_M)(n)$ for all large $n$, so $h_i/h_M$ is eventually constant — a rational function — contradicting dissimilarity. So each $r_i-r_M$ is a nonzero rational function, eventually nonvanishing; then $(r_i-r_M)h_i$ are hypergeometric terms, still pairwise dissimilar (they differ from $h_i$ by rational factors), and $M-1$ of them sum to zero — contradicting the induction hypothesis. $\blacksquare$

> **Lemma 2 (harmonic numbers are not rational).** There is no rational function $\rho$ and constants $a,C$ with $C\ne0$ such that $a+C\,H_{n}=\rho(n)$ for all large $n$.

*Proof.* $|a+CH_n|\to\infty$, so $\rho$ would have numerator degree exceeding denominator degree, forcing $|\rho(n)|\ge c\,n$ for large $n$ and some $c>0$. But $|a+CH_n|=O(\log n)=o(n)$. $\blacksquare$

> **Lemma 3 (hypergeometric kernel of $L^k$).** If $y$ is a hypergeometric term with $L^{k}y=0$ for all large $n$ (any $k\ge1$), then $y(n)=C\,(n-1)!$ for all large $n$.

*Proof.* First note that for hypergeometric $y$ with ratio $r$, each $L^{i}y$ is a rational multiple of $y$: inductively, if $L^{i}y=q(n)y(n)$ then $L^{i+1}y=\big(q(n{+}1)r(n)-n\,q(n)\big)y(n)$.

Let $j\ge1$ be minimal with $L^{j}y=0$ eventually. If $j=1$: $y(n+1)=n\,y(n)$, so $y(n)=C(n-1)!$ eventually. Suppose $j\ge2$. Put $u=L^{j-1}y$ and $v=L^{j-2}y$ (so $v=y$ if $j=2$). Both are rational multiples of $y$; by minimality neither rational factor is the zero function, so $u,v$ are hypergeometric terms. From $Lu=0$: $u(n)=C(n-1)!$ eventually, $C\ne0$. Write $v(n)=(n-1)!\,z(n)$; then $Lv=u$ reads

$$n!\,z(n+1)-n\,(n-1)!\,z(n)=C\,(n-1)!\quad\Longrightarrow\quad z(n+1)-z(n)=\frac{C}{n},$$

so $z(n)=a+C\,H_{n-1}$ eventually. Since $v$ is hypergeometric with rational ratio $\rho_v(n) = v(n+1)/v(n)$, set $A_n=a+CH_{n-1}$; from $A_{n+1}=A_n+C/n$ and $A_{n+1}=\frac{\rho_v(n)}{n}A_n$ we get $A_n\big(\rho_v(n)-n\big)=C$, i.e. $a+CH_{n-1}=C/(\rho_v(n)-n)$ — a rational function of $n$ with $C\neq 0$, contradicting Lemma 2. Hence $j=1$. $\blacksquare$

### 7.4 Proof of Theorem F

Fix $k\ge2$ and suppose ${n\brack k}=\sum_{i=1}^{M}h_i(n)$ for all large $n$, with $h_i$ hypergeometric terms. Grouping similarity classes (a sum of pairwise similar terms is a rational multiple of any one of them, hence again a hypergeometric term or eventually zero; drop zeros), we may assume the $h_i$ are pairwise dissimilar.

Apply $L^{k}$. By §7.2 the left side vanishes for $n\ge1$; by the first step of Lemma 3's proof, $L^{k}h_i=q_i(n)h_i(n)$ with $q_i$ rational. The nonzero terms among $q_ih_i$ are pairwise dissimilar hypergeometric terms summing to zero, so by Lemma 1 there are none: $q_i\equiv0$, i.e. $L^{k}h_i=0$ eventually, for every $i$. By Lemma 3 each $h_i(n)=C_i(n-1)!$ eventually, hence

$${n\brack k}=C\,(n-1)!\qquad\text{for all large } n,\ \ C=\textstyle\sum_iC_i .$$

But by Theorem B, ${n\brack k}/(n-1)!=e_{k-1}\big(1,\tfrac12,\dots,\tfrac1{n-1}\big)$, which is *strictly increasing* in $n$ once $n>k$ (passing from $n$ to $n+1$ adds $\tfrac1n\,e_{k-2}(1,\dots,\tfrac1{n-1})>0$), so it is not eventually constant. Contradiction.

For the signed version: $s(n,k)=(-1)^{n-k}c(n,k)$, and $h\mapsto(-1)^n h$ maps hypergeometric terms to hypergeometric terms, so $s(\cdot,k)\in\mathcal H\iff c(\cdot,k)\in\mathcal H$. $\blacksquare$

### 7.5 Machine certificates

Independent algorithmic confirmations of the load-bearing lemmas (all in `verify_all.py`):

* **Gosper's algorithm** on $\sum_{k\le n}1/k$ returns *no hypergeometric antidifference* (`gosper_sum -> None`): the $k=2$ germ of the theorem, $H_n\notin$ closed form, certified by the decision procedure itself.
* **Petkovšek's algorithm** (`rsolve_hyper`) applied to the minimal annihilator $(n{+}1)y(n)-(2n{+}3)y(n{+}1)+(n{+}2)y(n{+}2)=0$ of $H_n$ — whose full solution space is $\mathrm{span}\{1,H_n\}$ — returns **only constants**, and applied to the annihilator $L^2$ of $c(n{+}1,2)=n!\,H_n$ returns **only** $C\cdot n!$: exactly Lemma 3 for $k=2$, found mechanically by the complete decision procedure for hypergeometric solutions.
* The ladder identity, the strict growth of $c(n,k)/(n-1)!$, and $c(n,2)$'s annihilator were checked directly over wide ranges.

### 7.6 Where the columns actually live

$L^{k}$ is a product of first-order operators, so $c(\cdot,k)$ is **d'Alembertian**: expressible via $k-1$ nested indefinite sums over hypergeometric kernels — which is precisely what Theorem A displays, monomials $\prod_j (H^{(j)}_{n-1})^{m_j}$ of total weight $k-1$. The hierarchy is

$$\text{rational}\;\subset\;\text{hypergeometric sums }(\mathcal H)\;\subsetneq\;\text{d'Alembertian}\;\subset\;\text{Liouvillian}\;\subset\;\text{holonomic},$$

and the two halves of this document pin the columns of the first-kind triangle to their exact rung: **inside** d'Alembertian at depth $k-1$ (Theorems A–B, constructive), **strictly outside** $\mathcal H$ (Theorem F, impossibility). The Stirling numbers of the second kind sit one rung lower, inside $\mathcal H$ — and that single rung is the entire, now-proved, difference between the two kinds.

---

## 8. Verification summary

All checks in `verify_all.py`; full output in `verification_log.txt` (19/19 PASS, ~12 s):

| Claim | Method | Range |
|---|---|---|
| ground truth table | defining recurrence + OEIS spot values + independent sympy `stirling(kind=1)` | $n\le120$; sympy $n\le25$ |
| Theorem A (Bell/polygamma) | exact rationals | all $k\le n\le40$ |
| Theorem A (from float polygamma) | mpmath `psi`, 80 digits, round-to-integer | all $k\le n\le24$; worst residue $3\cdot10^{-58}$ |
| Theorem A′ (gamma-ratio derivative) | mpmath numerical differentiation | $n\in\{3,5,8,12,15\}$, all $k$ |
| Theorem A″ (partition sum) | exact rationals | all $k\le n\le18$ |
| Theorem B / B′ (symmetric / determinant) | exact | $n\le120$ / $n\le14$ |
| Theorem C (Schläfli double sum) | exact bigints | all $k\le n\le30$ |
| Theorem D (log-power EGF; contour integral) | exact / mpmath quadrature | $n\le40$ / 5 pairs |
| Theorem E (diagonals) | exact | all $m<n\le40$ |
| Theorem F certificates | Gosper, Petkovšek (sympy), direct checks | see §7.5 |

---

## 9. Direct answers to the brief

* *"Explicit formulation … ?"* — Yes, several, the sharpest being **Theorem A**: $\;{n\brack k}=\frac{(n-1)!}{(k-1)!}Y_{k-1}\big(\psi(n)-\psi(1),\ldots,\psi^{(k-2)}(n)-\psi^{(k-2)}(1)\big)$, plus the fully elementary double sum (Theorem C), determinant (B′), and integral (D) forms.
* *"…or a proof that such a formulation cannot exist?"* — Also yes, once "formulation" is formalized: **Theorem F** proves no fixed-length hypergeometric-term formula exists for any column $k\ge2$ — the formal sense in which the second kind has a closed form and the first kind provably cannot. Both statements are true simultaneously because they concern different formula classes, and together they locate the columns *exactly*: d'Alembertian of depth $k-1$, and no lower.
* *"Polygamma functions … derivatives of some permutation of the gamma function, perhaps an additional logarithm, lead to polynomial coefficients resulting in the Stirling numbers."* — Confirmed in the strongest form (Theorems A/A′/D): the row polynomial **is** $\Gamma(n+x)/\Gamma(x)$; its derivatives at $0$ **are** the Stirling numbers; pushing the derivatives through $\log\Gamma$ turns them into polygamma data with no residue; and the $x$-derivatives of the master identity produce the log-powers $(-\log(1-t))^k$. The hunch was not merely "a light link" — it is the constructive half of the answer.
* On resources: the question resolved by proof rather than search, so the 96 hours were not needed — the mathematics closes the problem, and every claim above is machine-verified in seconds by the included suite (extend the ranges in `verify_all.py` at will; every check is parameterized).

---

## References

1. L. Schläfli, *Sur les coëfficients du développement du produit $1(1+x)(1+2x)\cdots(1+(n-1)x)$ suivant les puissances ascendantes de $x$*, Crelle **43** (1852) — Theorem C.
2. H. W. Gould, *Stirling number representation problems*, Proc. AMS **11** (1960) — Theorem C in modern notation.
3. L. Comtet, *Advanced Combinatorics*, Reidel 1974 — Bell polynomials, Stirling identities.
4. R. Graham, D. Knuth, O. Patashnik, *Concrete Mathematics*, 2nd ed., §6.2–6.4 — ladder recurrences, eq. (6.44) (Theorem E).
5. V. Adamchik, *On Stirling numbers and Euler sums*, J. Comput. Appl. Math. **79** (1997) — harmonic-number/polygamma representations (Theorem A's classical antecedent).
6. M. Petkovšek, H. Wilf, D. Zeilberger, *A=B*, A K Peters 1996, Ch. 5 & 8 — hypergeometric terms, Gosper's and Petkovšek's algorithms, similarity (§7 framework).
7. S. A. Abramov, M. Petkovšek, *D'Alembertian solutions of linear differential and difference equations*, ISSAC '94 — the hierarchy of §7.6.
8. NIST DLMF, §5.15 (polygamma), §26.8 (Stirling numbers).
9. OEIS A132393 / A008275 — unsigned/signed Stirling numbers of the first kind (ground truth).
