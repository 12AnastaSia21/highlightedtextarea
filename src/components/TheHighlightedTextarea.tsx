import { Input, Button, Tooltip, ConfigProvider } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import React from "react";
import { customTheme } from "../themes/themeAntD";
import './TheHighlightedTextarea.sass'

const { TextArea } = Input;

const onChange = (
  e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
) => {
  console.log(e);
};

export default function TheHighlightedTextarea() {
  return (
    <ConfigProvider theme={customTheme}>
      <div className="highlighted-textarea-container">
        <TextArea
          className="highlighted-textarea-container__input"
          placeholder="Введите логическое выражение"
          allowClear
          onChange={onChange}
        />
        <Tooltip title="search">
          <Button ghost size="large" icon={<SearchOutlined />} />
        </Tooltip>
      </div>
    </ConfigProvider>
  );
}
