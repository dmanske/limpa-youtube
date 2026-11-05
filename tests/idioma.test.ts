import { describe, expect, it } from 'vitest';
import {
  botaoIndicaInscrever,
  botaoIndicaInscrito,
  ehBotaoConfirmar,
  ehItemCancelarInscricao,
  ehNumeroCurto,
  falaDeInscritos,
  lerContagemPortugues,
  normalizar,
  textoIndicaCaptcha,
} from '../src/content/idioma';

describe('normalizar', () => {
  it('tira acento, maiúsculas e espaços repetidos', () => {
    expect(normalizar('  Cancelar   Inscrição ')).toBe('cancelar inscricao');
  });
  it('aceita vazio', () => {
    expect(normalizar(null)).toBe('');
  });
});

describe('botão de quem já está inscrito', () => {
  it('reconhece em português', () => {
    expect(botaoIndicaInscrito(null, 'Inscrito')).toBe(true);
    expect(botaoIndicaInscrito('Cancelar inscrição de Canal X', '')).toBe(true);
    expect(botaoIndicaInscrito('Inscrito em Canal X', '')).toBe(true);
  });
  it('continua reconhecendo em inglês', () => {
    expect(botaoIndicaInscrito(null, 'Subscribed')).toBe(true);
    expect(botaoIndicaInscrito('Unsubscribe from Channel', '')).toBe(true);
  });
  it('não confunde com o botão de se inscrever', () => {
    expect(botaoIndicaInscrito('Inscreva-se em Canal X', 'Inscrever-se')).toBe(false);
    expect(botaoIndicaInscrito('Subscribe to Channel', 'Subscribe')).toBe(false);
  });
});

describe('botão de se inscrever', () => {
  it('reconhece em português', () => {
    expect(botaoIndicaInscrever(null, 'Inscrever-se')).toBe(true);
    expect(botaoIndicaInscrever('Inscreva-se em Canal X', '')).toBe(true);
  });
  it('continua reconhecendo em inglês', () => {
    expect(botaoIndicaInscrever('Subscribe to Channel', '')).toBe(true);
    expect(botaoIndicaInscrever(null, 'Subscribe')).toBe(true);
  });
  it('não confunde com quem já está inscrito', () => {
    expect(botaoIndicaInscrever('Unsubscribe from Channel', 'Subscribed')).toBe(false);
    expect(botaoIndicaInscrever('Cancelar inscrição de Canal X', 'Inscrito')).toBe(false);
  });
});

describe('item do menu', () => {
  it('acha o cancelamento', () => {
    expect(ehItemCancelarInscricao('Cancelar inscrição')).toBe(true);
    expect(ehItemCancelarInscricao('Unsubscribe')).toBe(true);
  });
  it('ignora as outras opções do menu', () => {
    expect(ehItemCancelarInscricao('Todas')).toBe(false);
    expect(ehItemCancelarInscricao('Personalizadas')).toBe(false);
    expect(ehItemCancelarInscricao('Nenhuma')).toBe(false);
    expect(ehItemCancelarInscricao('Cancelar')).toBe(false);
  });
});

describe('botão da janela de confirmação', () => {
  it('confirma com o texto certo', () => {
    expect(ehBotaoConfirmar('Cancelar inscrição')).toBe(true);
    expect(ehBotaoConfirmar('Unsubscribe')).toBe(true);
    expect(ehBotaoConfirmar('Confirmar')).toBe(true);
  });
  it('"Cancelar" sozinho é desistir, nunca confirmar', () => {
    expect(ehBotaoConfirmar('Cancelar')).toBe(false);
    expect(ehBotaoConfirmar('Cancel')).toBe(false);
  });
});

describe('captcha', () => {
  it('reconhece em português e em inglês', () => {
    expect(textoIndicaCaptcha('Confirme que você não é um robô')).toBe(true);
    expect(textoIndicaCaptcha('Detectamos tráfego incomum na sua rede')).toBe(true);
    expect(textoIndicaCaptcha('unusual traffic from your network')).toBe(true);
  });
  it('não dispara em texto comum', () => {
    expect(textoIndicaCaptcha('Canal de receitas e viagens')).toBe(false);
  });
});

describe('contagem de inscritos em português', () => {
  it('lê os formatos do YouTube', () => {
    expect(lerContagemPortugues('950 inscritos')).toBe(950);
    expect(lerContagemPortugues('1 inscrito')).toBe(1);
    expect(lerContagemPortugues('12,3 mil inscritos')).toBe(12_300);
    expect(lerContagemPortugues('1,2 mi de inscritos')).toBe(1_200_000);
    expect(lerContagemPortugues('1,5 bi de inscritos')).toBe(1_500_000_000);
    expect(lerContagemPortugues('2 milhões de inscritos')).toBe(2_000_000);
    expect(lerContagemPortugues('1.234 inscritos')).toBe(1_234);
  });
  it('lê número curto sem a palavra inscritos', () => {
    expect(lerContagemPortugues('12,3 mil')).toBe(12_300);
    expect(lerContagemPortugues('1,2 mi')).toBe(1_200_000);
  });
  it('deixa o formato em inglês para o leitor original', () => {
    expect(lerContagemPortugues('1.2M subscribers')).toBeUndefined();
    expect(lerContagemPortugues('1.2M')).toBeUndefined();
    expect(lerContagemPortugues('123')).toBeUndefined();
  });
  it('ignora texto que não é contagem', () => {
    expect(lerContagemPortugues('Canal de viagens')).toBeUndefined();
    expect(lerContagemPortugues('@canal123')).toBeUndefined();
  });
});

describe('apoio da leitura de inscritos', () => {
  it('identifica o texto de inscritos', () => {
    expect(falaDeInscritos('1,2 mi de inscritos')).toBe(true);
    expect(falaDeInscritos('1.2M subscribers')).toBe(true);
    expect(falaDeInscritos('Canal de viagens')).toBe(false);
  });
  it('identifica número curto', () => {
    expect(ehNumeroCurto('12,3 mil')).toBe(true);
    expect(ehNumeroCurto('1.2M')).toBe(true);
    expect(ehNumeroCurto('@canal')).toBe(false);
  });
});
