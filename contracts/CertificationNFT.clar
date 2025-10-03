(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-DOC-HASH u101)
(define-constant ERR-INVALID-ISSUE-DATE u102)
(define-constant ERR-INVALID-EXPIRY-DATE u103)
(define-constant ERR-INVALID-SUBJECTS u104)
(define-constant ERR-INVALID-ISSUING-BODY u105)
(define-constant ERR-CERT-ALREADY-MINTED u106)
(define-constant ERR-NFT-MINT-FAILED u107)
(define-constant ERR-FEE-TRANSFER-FAILED u108)
(define-constant ERR-INVALID-TEACHER u109)
(define-constant ERR-MAX-CERTS-EXCEEDED u110)

(define-non-fungible-token certification-nft uint)

(define-data-var next-cert-id uint u1)
(define-data-var max-certs uint u10000)
(define-data-var mint-fee uint u500)
(define-data-var issuer-contract (optional principal) none)
(define-data-var treasury principal 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7)

(define-map certifications
  { cert-id: uint }
  {
    teacher-id: principal,
    issuer: principal,
    doc-hash: (buff 32),
    issue-date: uint,
    expiry-date: (optional uint),
    subjects: (list 10 (string-ascii 50)),
    issuing-body: (string-ascii 100)
  }
)

(define-map cert-owners
  { cert-id: uint }
  principal
)

(define-read-only (get-cert-details (cert-id uint))
  (map-get? certifications { cert-id: cert-id })
)

(define-read-only (get-cert-owner (cert-id uint))
  (map-get? cert-owners { cert-id: cert-id })
)

(define-read-only (verify-ownership (cert-id uint) (teacher principal))
  (let ((owner (unwrap! (get-cert-owner cert-id) false)))
    (is-eq owner teacher)
  )
)

(define-read-only (is-cert-expired (cert-id uint))
  (let ((details (unwrap! (get-cert-details cert-id) false))
        (expiry (get expiry-date details))
        (current-block block-height))
    (match expiry
      exp (and (> current-block exp) true)
      false
    )
  )
)

(define-private (validate-doc-hash (hash (buff 32)))
  (if (> (len hash) u0) (ok true) (err ERR-INVALID-DOC-HASH))
)

(define-private (validate-issue-date (date uint))
  (if (>= date block-height) (ok true) (err ERR-INVALID-ISSUE-DATE))
)

(define-private (validate-expiry-date (exp (optional uint)) (issue uint))
  (match exp
    some-exp (if (> some-exp issue) (ok true) (err ERR-INVALID-EXPIRY-DATE))
    (ok true)
  )
)

(define-private (validate-subjects (subs (list 10 (string-ascii 50))))
  (let ((len (len subs)))
    (if (and (> len u0) (<= len u10)) (ok true) (err ERR-INVALID-SUBJECTS))
  )
)

(define-private (validate-issuing-body (body (string-ascii 100)))
  (if (and (> (len body) u0) (<= (len body) u100)) (ok true) (err ERR-INVALID-ISSUING-BODY))
)

(define-private (validate-teacher (teacher principal))
  (if (is-principal teacher) (ok true) (err ERR-INVALID-TEACHER))
)

(define-private (is-authorized-issuer)
  (let ((issuer-contract (var-get issuer-contract)))
    (match issuer-contract
      some-ic (contract-call? .certification-issuer-contract is-authorized-issuer tx-sender)
      (err ERR-NOT-AUTHORIZED)
    )
  )
)

(define-public (set-issuer-contract (contract-principal principal))
  (begin
    (asserts! (is-none (var-get issuer-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set issuer-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-mint-fee (new-fee uint))
  (begin
    (asserts! (is-some (var-get issuer-contract)) (err ERR-NOT-AUTHORIZED))
    (asserts! (>= new-fee u0) (err u1))
    (var-set mint-fee new-fee)
    (ok true)
  )
)

(define-public (set-treasury (new-treasury principal))
  (begin
    (asserts! (is-some (var-get issuer-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set treasury new-treasury)
    (ok true)
  )
)

(define-public (mint-cert-nft
  (teacher principal)
  (doc-hash (buff 32))
  (issue-date uint)
  (expiry-date (optional uint))
  (subjects (list 10 (string-ascii 50)))
  (issuing-body (string-ascii 100)))
  (let (
        (next-id (var-get next-cert-id))
        (max-certs (var-get max-certs))
        (fee (var-get mint-fee))
        (treasury-addr (var-get treasury))
      )
    (asserts! (< next-id max-certs) (err ERR-MAX-CERTS-EXCEEDED))
    (try! (validate-teacher teacher))
    (try! (validate-doc-hash doc-hash))
    (try! (validate-issue-date issue-date))
    (try! (validate-expiry-date expiry-date issue-date))
    (try! (validate-subjects subjects))
    (try! (validate-issuing-body issuing-body))
    (try! (is-authorized-issuer))
    (asserts! (is-none (map-get? certifications { cert-id: next-id })) (err ERR-CERT-ALREADY-MINTED))
    (try! (stx-transfer? fee tx-sender treasury-addr))
    (try! (contract-call? .certification-issuer-contract pay-mint-fee fee))
    (try! (nft-mint? certification-nft next-id teacher))
    (map-insert certifications { cert-id: next-id }
      {
        teacher-id: teacher,
        issuer: tx-sender,
        doc-hash: doc-hash,
        issue-date: issue-date,
        expiry-date: expiry-date,
        subjects: subjects,
        issuing-body: issuing-body
      }
    )
    (map-insert cert-owners { cert-id: next-id } teacher)
    (var-set next-cert-id (+ next-id u1))
    (print { event: "cert-minted", id: next-id })
    (ok next-id)
  )
)

(define-public (burn-expired-cert (cert-id uint))
  (let (
        (owner (unwrap! (get-cert-owner cert-id) (err ERR-NOT-AUTHORIZED)))
        (is-exp (is-cert-expired cert-id))
      )
    (asserts! (is-eq tx-sender owner) (err ERR-NOT-AUTHORIZED))
    (asserts! is-exp (err u1))
    (try! (nft-burn? certification-nft cert-id owner))
    (map-delete certifications { cert-id: cert-id })
    (map-delete cert-owners { cert-id: cert-id })
    (ok true)
  )
)

(define-read-only (get-next-cert-id)
  (var-get next-cert-id)
)

(define-read-only (get-mint-fee)
  (var-get mint-fee)
)