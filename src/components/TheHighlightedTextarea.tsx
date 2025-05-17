import { Input, Button, Tooltip, ConfigProvider, Alert } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import React, { useState } from "react";
import { customTheme } from "../themes/themeAntD";
import { createToken, Lexer, CstParser, type IToken } from "chevrotain";
import "./TheHighlightedTextarea.sass";

const { TextArea } = Input;

// Тип логического блока
type BlockType = "TYPE1" | "TYPE2";

// Токены
const Whitespace = createToken({
  name: "Whitespace",
  pattern: /\s+/,
  group: "whitespace",
});
const Not = createToken({ name: "Not", pattern: /\bNOT\b/ });
const And = createToken({ name: "And", pattern: /\bAND\b/ });
const Or = createToken({ name: "Or", pattern: /\bOR\b/ });
const LParen = createToken({ name: "LParen", pattern: /\(/ });
const RParen = createToken({ name: "RParen", pattern: /\)/ });
const Key = createToken({ name: "Key", pattern: /\b[A-Z]+=/ });
const Quoted = createToken({
  name: "Quoted",
  pattern: /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/,
});
const Word = createToken({ name: "Word", pattern: /[a-zA-Z0-9_*-]+/ });

const allTokens = [Whitespace, Not, And, Or, LParen, RParen, Key, Quoted, Word];

const lexer = new Lexer(allTokens, {
  ensureOptimizations: true,
});

// Парсер
class LogicParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  public expression = this.RULE("expression", () => {
    this.SUBRULE(this.binary, { LABEL: "expr" });
  });

  private binary = this.RULE("binary", () => {
    this.SUBRULE(this.primary, { LABEL: "left" });
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(And, { LABEL: "operator" }) },
        { ALT: () => this.CONSUME(Or, { LABEL: "operator" }) },
      ]);
      this.SUBRULE2(this.primary, { LABEL: "right" });
    });
  });

  private primary = this.RULE("primary", () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.prefix, { LABEL: "prefix" }) },
      { ALT: () => this.SUBRULE(this.group, { LABEL: "group" }) },
      { ALT: () => this.SUBRULE(this.block, { LABEL: "block" }) },
    ]);
  });

  private prefix = this.RULE("prefix", () => {
    this.CONSUME(Not, { LABEL: "not" });
    this.SUBRULE(this.primary, { LABEL: "child" });
  });

  private group = this.RULE("group", () => {
    this.CONSUME(LParen, { LABEL: "lparen" });
    this.SUBRULE(this.expression, { LABEL: "child" });
    this.CONSUME(RParen, { LABEL: "rparen" });
  });

  private block = this.RULE("block", () => {
    this.OR([
      { ALT: () => this.CONSUME(Quoted, { LABEL: "quoted" }) },
      { ALT: () => this.CONSUME(Word, { LABEL: "word" }) },
      {
        ALT: () => {
          this.CONSUME(Key, { LABEL: "key" });
          this.CONSUME2(Quoted, { LABEL: "value" });
        },
      },
    ]);
  });
}

// Интерфейс для CST узлов
interface CstNode {
  name: string;
  children: {
    [key: string]: (CstNode | IToken)[];
  };
}

// Проверка однотипности блоков
function validateBlockTypes(cst: CstNode): void {
  const blockTypes = new Set<BlockType>();

  function traverse(node: CstNode | IToken) {
    if ("name" in node) {
      // CstNode
      if (node.name === "block") {
        const children = node.children;
        if (children.quoted || children.word) {
          blockTypes.add("TYPE1");
        } else if (children.key && children.value) {
          blockTypes.add("TYPE2");
        }
      }
      Object.values(node.children).forEach((childArray) =>
        childArray.forEach(traverse)
      );
    }
  }

  traverse(cst);

  if (blockTypes.size > 1) {
    throw new Error("All blocks must be of the same type (TYPE1 or TYPE2)");
  }
}

// Преобразование CST в AST
interface ASTNode {
  type: "BINARY" | "PREFIX" | "GROUP" | "BLOCK";
  value?: string;
  blockType?: BlockType;
  left?: ASTNode;
  right?: ASTNode;
  child?: ASTNode;
}

function isIToken(node: any): node is IToken {
  return node && typeof node.image === "string" && !!node.tokenType;
}

function cstToAst(cst: CstNode): ASTNode {
  function visit(node: CstNode | IToken): ASTNode {
    if (isIToken(node)) {
      return {
        type: "BLOCK",
        value: node.image,
        blockType:
          node.tokenType.name === "Key" || node.tokenType.name === "Quoted"
            ? "TYPE2"
            : "TYPE1",
      };
    }

    const cstNode = node as CstNode;

    switch (cstNode.name) {
      case "expression":
        return visit(cstNode.children.expr[0]);

      case "binary": {
        const left = visit(cstNode.children.left[0]);
        if (!cstNode.children.operator) return left;

        const operators = cstNode.children.operator;
        const rights = cstNode.children.right;
        let current: ASTNode = left;

        for (let i = 0; i < operators.length; i++) {
          const operator = operators[i];
          const right = visit(rights[i]);

          if (!isIToken(operator)) {
            throw new Error("Operator should be a token");
          }

          current = {
            type: "BINARY",
            value: operator.image,
            left: current,
            right,
            blockType: left.blockType || right.blockType,
          };
        }

        return current;
      }

      case "prefix": {
        const notNode = cstNode.children.not[0];
        if (!isIToken(notNode)) {
          throw new Error("Expected token for 'NOT'");
        }

        const child = visit(cstNode.children.child[0]);

        return {
          type: "PREFIX",
          value: notNode.image,
          child,
          blockType: child.blockType,
        };
      }

      case "group": {
        const child = visit(cstNode.children.child[0]);

        return {
          type: "GROUP",
          child,
          blockType: child.blockType,
        };
      }

      case "block": {
        const { quoted, word, key, value } = cstNode.children;

        if (quoted && quoted.length > 0) {
          const quotedToken = quoted[0];
          if (!isIToken(quotedToken)) throw new Error("Expected quoted token");
          return {
            type: "BLOCK",
            value: quotedToken.image,
            blockType: "TYPE1",
          };
        }

        if (word && word.length > 0) {
          const wordToken = word[0];
          if (!isIToken(wordToken)) throw new Error("Expected word token");
          return {
            type: "BLOCK",
            value: wordToken.image,
            blockType: "TYPE1",
          };
        }

        if (key && key.length > 0 && value && value.length > 0) {
          const keyToken = key[0];
          const valueToken = value[0];
          if (!isIToken(keyToken) || !isIToken(valueToken)) {
            throw new Error("Expected key/value tokens");
          }
          return {
            type: "BLOCK",
            value: `${keyToken.image}${valueToken.image}`,
            blockType: "TYPE2",
          };
        }

        throw new Error("Invalid block structure");
      }

      case "primary": {
        if (cstNode.children.prefix && cstNode.children.prefix.length > 0) {
          return visit(cstNode.children.prefix[0]);
        } else if (
          cstNode.children.group &&
          cstNode.children.group.length > 0
        ) {
          return visit(cstNode.children.group[0]);
        } else if (
          cstNode.children.block &&
          cstNode.children.block.length > 0
        ) {
          return visit(cstNode.children.block[0]);
        }
        throw new Error("Invalid primary node structure");
      }

      default:
        throw new Error(`Unknown CST node: ${cstNode.name}`);
    }
  }

  return visit(cst);
}

const parser = new LogicParser();

export default function TheHighlightedTextarea() {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const value = e.target.value;
    setInput(value);
    setError(null);

    try {
      // Токенизация
      const lexResult = lexer.tokenize(value);
      if (lexResult.errors.length > 0) {
        throw new Error(lexResult.errors[0].message);
      }

      // Парсинг
      parser.input = lexResult.tokens;
      const cst = parser.expression();
      if (parser.errors.length > 0) {
        throw new Error(parser.errors[0].message);
      }

      // Проверка однотипности блоков
      validateBlockTypes(cst);

      // Преобразование в AST
      const ast = cstToAst(cst);
      console.log("AST:", JSON.stringify(ast, null, 2));
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
        console.error("Parsing error:", err.message);
      } else {
        setError("Произошла неизвестная ошибка");
        console.error("Parsing error (unknown):", err);
      }
    }
  };

  return (
    <ConfigProvider theme={customTheme}>
      <div className="highlighted-textarea-container">
        <div className="highlighted-textarea-container__search-container">
          <TextArea
            className="highlighted-textarea-container__input"
            placeholder="Введите логическое выражение"
            allowClear
            onChange={handleChange}
            value={input}
            spellCheck={false}
          />
          <Tooltip title="search">
            <Button ghost size="large" icon={<SearchOutlined />} />
          </Tooltip>
        </div>
        {error && (
          <Alert
            message="Ошибка парсинга"
            description={error}
            type="error"
            showIcon
          />
        )}
      </div>
    </ConfigProvider>
  );
}
