import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, listCV, someCV, noneCV, bufferCV, principalCV, uintCV, optionalCV, bufferType, uintType } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_DOC_HASH = 101;
const ERR_INVALID_ISSUE_DATE = 102;
const ERR_INVALID_EXPIRY_DATE = 103;
const ERR_INVALID_SUBJECTS = 104;
const ERR_INVALID_ISSUING_BODY = 105;
const ERR_CERT_ALREADY_MINTED = 106;
const ERR_NFT_MINT_FAILED = 107;
const ERR_FEE_TRANSFER_FAILED = 108;
const ERR_INVALID_TEACHER = 109;
const ERR_MAX_CERTS_EXCEEDED = 110;

interface Certification {
  teacherId: string;
  issuer: string;
  docHash: Buffer;
  issueDate: bigint;
  expiryDate: bigint | null;
  subjects: string[];
  issuingBody: string;
}

interface CertOwner {
  certId: number;
  owner: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class CertificationNFTMock {
  state: {
    nextCertId: number;
    maxCerts: number;
    mintFee: number;
    issuerContract: string | null;
    treasury: string;
    certifications: Map<number, Certification>;
    certOwners: Map<number, string>;
    nftOwners: Map<number, string>;
  } = {
    nextCertId: 1,
    maxCerts: 10000,
    mintFee: 500,
    issuerContract: null,
    treasury: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
    certifications: new Map(),
    certOwners: new Map(),
    nftOwners: new Map(),
  };
  blockHeight: number = 100;
  caller: string = "ST1TEACHER";
  authorizedIssuers: Set<string> = new Set(["ST1ISSUER"]);
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];
  issuerFeePayments: Array<{ amount: number; from: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextCertId: 1,
      maxCerts: 10000,
      mintFee: 500,
      issuerContract: null,
      treasury: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      certifications: new Map(),
      certOwners: new Map(),
      nftOwners: new Map(),
    };
    this.blockHeight = 100;
    this.caller = "ST1TEACHER";
    this.authorizedIssuers = new Set(["ST1ISSUER"]);
    this.stxTransfers = [];
    this.issuerFeePayments = [];
  }

  isAuthorizedIssuer(caller: string): Result<boolean> {
    return { ok: true, value: this.authorizedIssuers.has(caller) };
  }

  setIssuerContract(contractPrincipal: string): Result<boolean> {
    if (this.state.issuerContract !== null) return { ok: false, value: false };
    this.state.issuerContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setMintFee(newFee: number): Result<boolean> {
    if (!this.state.issuerContract) return { ok: false, value: false };
    this.state.mintFee = newFee;
    return { ok: true, value: true };
  }

  setTreasury(newTreasury: string): Result<boolean> {
    if (!this.state.issuerContract) return { ok: false, value: false };
    this.state.treasury = newTreasury;
    return { ok: true, value: true };
  }

  payMintFeeMock(amount: number): Result<boolean> {
    this.issuerFeePayments.push({ amount, from: this.caller });
    return { ok: true, value: true };
  }

  mintCertNFT(
    teacher: string,
    docHash: Buffer,
    issueDate: number,
    expiryDate: number | null,
    subjects: string[],
    issuingBody: string
  ): Result<number> {
    if (this.state.nextCertId >= this.state.maxCerts) return { ok: false, value: ERR_MAX_CERTS_EXCEEDED };
    if (!Buffer.isBuffer(docHash) || docHash.length === 0) return { ok: false, value: ERR_INVALID_DOC_HASH };
    if (issueDate < this.blockHeight) return { ok: false, value: ERR_INVALID_ISSUE_DATE };
    if (expiryDate !== null && expiryDate <= issueDate) return { ok: false, value: ERR_INVALID_EXPIRY_DATE };
    if (subjects.length === 0 || subjects.length > 10 || subjects.some(s => s.length > 50)) return { ok: false, value: ERR_INVALID_SUBJECTS };
    if (issuingBody.length === 0 || issuingBody.length > 100) return { ok: false, value: ERR_INVALID_ISSUING_BODY };
    if (!this.isAuthorizedIssuer(this.caller).value) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.certifications.has(this.state.nextCertId)) return { ok: false, value: ERR_CERT_ALREADY_MINTED };

    this.stxTransfers.push({ amount: this.state.mintFee, from: this.caller, to: this.state.treasury });
    this.payMintFeeMock(this.state.mintFee);

    const id = this.state.nextCertId;
    const cert: Certification = {
      teacherId: teacher,
      issuer: this.caller,
      docHash,
      issueDate: BigInt(issueDate),
      expiryDate: expiryDate ? BigInt(expiryDate) : null,
      subjects,
      issuingBody,
    };
    this.state.certifications.set(id, cert);
    this.state.certOwners.set(id, teacher);
    this.state.nftOwners.set(id, teacher);
    this.state.nextCertId++;
    return { ok: true, value: id };
  }

  getCertDetails(id: number): Certification | null {
    return this.state.certifications.get(id) || null;
  }

  getCertOwner(id: number): string | null {
    return this.state.certOwners.get(id) || null;
  }

  verifyOwnership(id: number, teacher: string): boolean {
    const owner = this.getCertOwner(id);
    return owner === teacher;
  }

  isCertExpired(id: number): boolean {
    const cert = this.getCertDetails(id);
    if (!cert || cert.expiryDate === null) return false;
    return this.blockHeight > Number(cert.expiryDate);
  }

  burnExpiredCert(id: number): Result<boolean> {
    const owner = this.getCertOwner(id);
    if (!owner || owner !== this.caller) return { ok: false, value: false };
    if (!this.isCertExpired(id)) return { ok: false, value: false };
    this.state.certifications.delete(id);
    this.state.certOwners.delete(id);
    this.state.nftOwners.delete(id);
    return { ok: true, value: true };
  }

  getNextCertId(): Result<number> {
    return { ok: true, value: this.state.nextCertId };
  }

  getMintFee(): Result<number> {
    return { ok: true, value: this.state.mintFee };
  }
}

describe("CertificationNFT", () => {
  let contract: CertificationNFTMock;

  beforeEach(() => {
    contract = new CertificationNFTMock();
    contract.reset();
    contract.setIssuerContract("ST1ISSUER");
  });

  it("rejects mint by unauthorized issuer", () => {
    contract.caller = "ST2UNAUTH";
    contract.authorizedIssuers = new Set();
    const docHash = Buffer.from("deadbeef", "hex");
    const subjects = ["Math"];
    const result = contract.mintCertNFT(
      "ST1TEACHER",
      docHash,
      101,
      null,
      subjects,
      "University B"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects mint with invalid doc hash", () => {
    const emptyHash = Buffer.alloc(0);
    const subjects = ["Math"];
    const result = contract.mintCertNFT(
      "ST1TEACHER",
      emptyHash,
      101,
      null,
      subjects,
      "University C"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DOC_HASH);
  });

  it("rejects mint with past issue date", () => {
    const docHash = Buffer.from("deadbeef", "hex");
    const subjects = ["Math"];
    const result = contract.mintCertNFT(
      "ST1TEACHER",
      docHash,
      50,
      null,
      subjects,
      "University D"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ISSUE_DATE);
  });

  it("rejects mint with invalid expiry date", () => {
    const docHash = Buffer.from("deadbeef", "hex");
    const subjects = ["Math"];
    const result = contract.mintCertNFT(
      "ST1TEACHER",
      docHash,
      101,
      100,
      subjects,
      "University E"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_EXPIRY_DATE);
  });

  it("rejects mint with invalid subjects", () => {
    const docHash = Buffer.from("deadbeef", "hex");
    const emptySubjects: string[] = [];
    const result = contract.mintCertNFT(
      "ST1TEACHER",
      docHash,
      101,
      null,
      emptySubjects,
      "University F"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_SUBJECTS);
  });

  it("rejects mint with invalid issuing body", () => {
    const docHash = Buffer.from("deadbeef", "hex");
    const subjects = ["Math"];
    const longBody = "A".repeat(101);
    const result = contract.mintCertNFT(
      "ST1TEACHER",
      docHash,
      101,
      null,
      subjects,
      longBody
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ISSUING_BODY);
  });

  it("rejects mint when max certs exceeded", () => {
    contract.state.maxCerts = 1;
    contract.state.nextCertId = 1;
    const docHash = Buffer.from("deadbeef", "hex");
    const subjects = ["Math"];
    const result = contract.mintCertNFT(
      "ST1TEACHER",
      docHash,
      101,
      null,
      subjects,
      "University G"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_CERTS_EXCEEDED);
  });

  it("rejects burn by non-owner", () => {
    const docHash = Buffer.from("deadbeef", "hex");
    const subjects = ["Math"];
    contract.mintCertNFT(
      "ST1TEACHER",
      docHash,
      101,
      150,
      subjects,
      "University L"
    );
    contract.blockHeight = 160;
    contract.caller = "ST2FAKE";
    const result = contract.burnExpiredCert(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects burn non-expired cert", () => {
    const docHash = Buffer.from("deadbeef", "hex");
    const subjects = ["Math"];
    contract.mintCertNFT(
      "ST1TEACHER",
      docHash,
      101,
      200,
      subjects,
      "University M"
    );
    contract.blockHeight = 150;
    contract.caller = "ST1TEACHER";
    const result = contract.burnExpiredCert(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets mint fee successfully", () => {
    const result = contract.setMintFee(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.mintFee).toBe(1000);
  });

  it("rejects set mint fee without issuer contract", () => {
    contract.state.issuerContract = null;
    const result = contract.setMintFee(1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
});